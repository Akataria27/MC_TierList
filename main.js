'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { migrateLibrary, emptyLibrary } = require('./lib/items');
const libmod = require('./lib/library');
const importer = require('./lib/jar/importer');
const { findInstalledJars } = require('./lib/jar/detect');
const { Worker } = require('worker_threads');
const uimod = require('./lib/jar/ui');

const APP_DIR = path.join(__dirname, 'app');
const DATA_DIR = process.env.MCTIER_DATA || path.join(__dirname, 'data');
const ITEMS_DIR = path.join(DATA_DIR, 'items');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UI_DIR = path.join(DATA_DIR, 'ui');
const LIB_FILE = path.join(DATA_DIR, 'library.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const BACKUP_EVERY_MS = 30 * 60 * 1000;
const BACKUPS_KEPT = 30;

let win = null;
let building = null; // { build, staging } waiting for the user to confirm
let importing = false;
const STAGING = () => path.join(DATA_DIR, '.staging');
let lastBackupAt = 0;

// Serve the UI and the item sprites from one origin so canvas export is never tainted.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readLibrary() {
  return migrateLibrary(readJson(LIB_FILE) || emptyLibrary());
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pruneBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('progress-') && f.endsWith('.json')).sort();
    while (files.length > BACKUPS_KEPT) fs.rmSync(path.join(BACKUP_DIR, files.shift()), { force: true });
  } catch (e) { /* ignore */ }
}

function maybeBackup(force) {
  if (!force && Date.now() - lastBackupAt < BACKUP_EVERY_MS) return;
  if (!fs.existsSync(PROGRESS_FILE)) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(PROGRESS_FILE, path.join(BACKUP_DIR, 'progress-' + stamp() + '.json'));
    lastBackupAt = Date.now();
    pruneBackups();
  } catch (e) { /* ignore */ }
}

function newestValidBackup() {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('progress-') && f.endsWith('.json')).sort().reverse();
    for (const f of files) {
      const data = readJson(path.join(BACKUP_DIR, f));
      if (data && data.v === 3 && data.nodes && Array.isArray(data.order)) return data;
    }
  } catch (e) { /* ignore */ }
  return null;
}

ipcMain.handle('load', () => {
  const library = readLibrary();
  let progress = readJson(PROGRESS_FILE);
  let recovered = false;
  if (!progress && fs.existsSync(PROGRESS_FILE)) {
    progress = newestValidBackup();
    recovered = !!progress;
  }
  return { library, progress, recovered, dataDir: DATA_DIR };
});

ipcMain.handle('save-progress', (e, state) => {
  try {
    maybeBackup();
    writeAtomic(PROGRESS_FILE, JSON.stringify(state));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ---- jar import ----------------------------------------------------------
const failMsg = (e) => ({ error: String((e && e.message) || e) });

ipcMain.handle('jar-installed', () => {
  try { return { jars: findInstalledJars(), current: readLibrary().version }; } catch (e) { return { jars: [], current: '' }; }
});

ipcMain.handle('jar-pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a Minecraft client jar (e.g. 26.3.jar)', properties: ['openFile'], filters: [{ name: 'Minecraft jar', extensions: ['jar'] }] });
  return r.canceled || !r.filePaths.length ? { canceled: true } : { path: r.filePaths[0] };
});

ipcMain.handle('jar-inspect', (e, file) => {
  try {
    const info = importer.inspect(String(file)), lib = readLibrary();
    return { ok: true, version: info.version, itemCount: info.ids.length, relation: libmod.relation(lib, info.version), current: lib.version, path: info.jarPath };
  } catch (err) { return failMsg(err); }
});

// Renders every icon into a staging folder; nothing in the library changes until jar-commit.
ipcMain.handle('jar-build', (e, file) => new Promise((resolve) => {
  if (importing) return resolve({ error: 'An import is already running.' });
  importing = true; building = null;
  const staging = STAGING();
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch (x) { /* ignore */ }
  let finished = false;
  const done = (v) => { if (finished) return; finished = true; importing = false; resolve(v); };
  let worker;
  try { worker = new Worker(path.join(__dirname, 'lib/jar/worker.js'), { workerData: { jarPath: String(file), outDir: staging } }); }
  catch (err) { return done(failMsg(err)); }
  worker.on('message', (m) => {
    if (m.type === 'progress') { if (win && !win.isDestroyed()) win.webContents.send('jar-progress', m.p); }
    else if (m.type === 'error') done({ error: m.error });
    else if (m.type === 'done') {
      try { building = { build: m.result, staging, jar: String(file) }; done({ ok: true, plan: libmod.plan(readLibrary(), m.result) }); }
      catch (err) { done(failMsg(err)); }
    }
  });
  worker.on('error', (err) => done(failMsg(err)));
  worker.on('exit', (code) => { if (!finished) done({ error: 'The import stopped unexpectedly (code ' + code + ').' }); });
}));

ipcMain.handle('jar-cancel', () => { building = null; try { fs.rmSync(STAGING(), { recursive: true, force: true }); } catch (e) { /* ignore */ } return { ok: true }; });

ipcMain.handle('jar-commit', (e, opts) => {
  if (!building) return { error: 'Nothing is waiting to be applied. Start the import again.' };
  try {
    const res = libmod.commit({ dataDir: DATA_DIR, lib: readLibrary(), build: building.build, staging: building.staging, renames: opts && opts.renames, backup: () => maybeBackup(true) });
    let look = { ok: false };
    try { look = uimod.build(building.jar, UI_DIR); } catch (err) { look = { ok: false, error: String((err && err.message) || err) }; }
    building = null;
    res.look = look;
    return res;
  } catch (err) { return failMsg(err); }
});

// Game look only (font + tab sprites), for libraries imported before this existed.
ipcMain.handle('ui-build', (e, file) => { try { return uimod.build(String(file), UI_DIR); } catch (err) { return failMsg(err); } });
ipcMain.handle('ui-status', () => { try { return uimod.status(UI_DIR); } catch (err) { return { ok: false, complete: false, missing: [], border: 3 }; } });

ipcMain.handle('jar-undo-info', () => {
  const s = libmod.latestSnapshot(DATA_DIR);
  return s ? { ok: true, meta: s.meta } : { ok: false };
});
ipcMain.handle('jar-undo', () => { try { maybeBackup(true); return Object.assign({ ok: true }, libmod.undo(DATA_DIR)); } catch (err) { return failMsg(err); } });

ipcMain.handle('clear-new-flags', () => {
  const lib = readLibrary(); let n = 0;
  for (const i of lib.items) if (i.new) { delete i.new; n++; }
  if (n) { lib.rev++; writeAtomic(LIB_FILE, JSON.stringify(lib)); }
  return { library: lib, cleared: n };
});

ipcMain.handle('save-image', async (e, dataUrl, name) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save tier list as image',
    defaultPath: name || 'tier-list.png',
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return { ok: true, path: r.filePath };
});

ipcMain.handle('export-progress', async (e, state) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export progress',
    defaultPath: 'mc-tierlist-progress.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, JSON.stringify(state, null, 2));
  return { ok: true, path: r.filePath };
});

ipcMain.handle('import-progress', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Restore progress from file',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const data = readJson(r.filePaths[0]);
  if (!data || !data.nodes || !Array.isArray(data.order)) {
    return { error: 'That file is not a tier list progress file.' };
  }
  return { state: data };
});

ipcMain.handle('backup-now', () => {
  maybeBackup(true);
  return { ok: true };
});

ipcMain.handle('save-text', async (e, text, name) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save code as file',
    defaultPath: name || 'tier-list-code.txt',
    filters: [{ name: 'Text file', extensions: ['txt'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, String(text));
  return { ok: true, path: r.filePath };
});

ipcMain.handle('open-text', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Load code from file',
    properties: ['openFile'],
    filters: [{ name: 'Text file', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const file = r.filePaths[0];
  if (fs.statSync(file).size > 40 * 1024 * 1024) return { error: 'That file is too large to be a tier list code.' };
  return { text: fs.readFileSync(file, 'utf8') };
});

ipcMain.handle('open-data-folder', () => shell.openPath(DATA_DIR));

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#17181c',
    title: 'MC Tier List',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL('app://local/index.html');
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  fs.mkdirSync(ITEMS_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  try { fs.rmSync(STAGING(), { recursive: true, force: true }); } catch (e) { /* leftover from a crash */ }

  protocol.handle('app', async (request) => {
    const u = new URL(request.url);
    const p = decodeURIComponent(u.pathname);
    let file = null;
    if (p.startsWith('/items/')) {
      file = path.join(ITEMS_DIR, path.basename(p));
    } else if (p.startsWith('/ui/')) {
      file = path.join(UI_DIR, path.basename(p));
    } else {
      const full = path.resolve(APP_DIR, p === '/' ? 'index.html' : p.slice(1));
      if (full.startsWith(APP_DIR + path.sep)) file = full;
    }
    if (!file) return new Response('Not found', { status: 404 });
    // Read the file ourselves: ~1,800 icons can be requested at once and net.fetch drops some under that burst.
    try {
      const buf = await fs.promises.readFile(file);
      const ext = path.extname(file).toLowerCase();
      const types = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.ogg': 'audio/ogg', '.json': 'application/json' };
      const headers = { 'content-type': types[ext] || 'application/octet-stream' };
      if (file.startsWith(UI_DIR)) headers['cache-control'] = 'no-store';
      return new Response(buf, { headers });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
