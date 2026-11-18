'use strict';
// Library bookkeeping for imports: diffing versions, committing, snapshots and undo. Pure Node.
const fs = require('fs');
const path = require('path');
const { emptyLibrary } = require('./items');

const KEEP_SNAPSHOTS = 10;
const isPlaceholder = (i) => !!i.placeholder;
const realItems = (lib) => lib.items.filter((i) => !isPlaceholder(i));

function writeAtomic(file, text) { const t = file + '.tmp'; fs.writeFileSync(t, text); fs.renameSync(t, file); }
function moveDir(from, to) {
  try { fs.renameSync(from, to); } catch (e) { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); }
}

// How does the jar relate to what is installed? 'first' | 'same' | 'newer' | 'older'
function relation(lib, info) {
  if (!realItems(lib).length) return 'first';
  const a = lib.versionInfo || {}, b = info || {};
  if (a.world && b.world) return b.world === a.world ? 'same' : b.world > a.world ? 'newer' : 'older';
  return lib.version === b.id ? 'same' : 'newer';
}

// Compare the library with a built result (nothing is written).
function plan(lib, build) {
  const rel = relation(lib, build.version), old = realItems(lib);
  const oldIds = new Set(old.map((i) => i.id)), newIds = new Set(build.items.map((i) => i.id));
  const added = build.items.filter((i) => !oldIds.has(i.id));
  const removed = old.filter((i) => !newIds.has(i.id) && !i.removedIn);
  const returned = old.filter((i) => i.removedIn && newIds.has(i.id));
  const uniq = (list) => { const m = new Map(); for (const i of list) { if (i.gen || !i.h) continue; m.set(i.h, m.has(i.h) ? null : i); } return m; };
  const addedByHash = uniq(added), removedByHash = uniq(removed), renames = [];
  if (rel !== 'first') for (const [h, o] of removedByHash) { const n = addedByHash.get(h); if (o && n) renames.push({ from: o.id, to: n.id, fromName: o.name, toName: n.name }); }
  return { relation: rel, added: added.map((i) => ({ id: i.id, name: i.name })), removed: removed.map((i) => ({ id: i.id, name: i.name })), returned: returned.length, renames, failed: build.failed || [] };
}

// Swaps the staged icons in and writes the new library. Returns what the window must apply to its progress.
function commit(o) {
  const { dataDir, lib, build, staging, backup } = o;
  const itemsDir = path.join(dataDir, 'items'), libFile = path.join(dataDir, 'library.json'), snapRoot = path.join(dataDir, 'snapshots');
  const p = plan(lib, build), first = p.relation === 'first', same = p.relation === 'same', v = build.version;
  const valid = new Map(p.renames.map((r) => [r.from + '>' + r.to, r])), renames = (o.renames || []).filter((r) => valid.has(r.from + '>' + r.to));
  const renamedTo = new Map(renames.map((r) => [r.to, r.from])), renamedFrom = new Set(renames.map((r) => r.from));
  const oldById = new Map(lib.items.map((i) => [i.id, i]));
  const newIds = new Set(build.items.map((i) => i.id));

  const items = build.items.map((b) => {
    const prior = oldById.get(b.id), src = renamedTo.has(b.id) ? oldById.get(renamedTo.get(b.id)) : prior && !isPlaceholder(prior) ? prior : null;
    const rec = Object.assign({}, b); delete rec.real;
    rec.since = src && src.since ? src.since : v.id;
    if (src && src.new) rec.new = true;
    else if (!src && !first && !same) rec.new = true;
    return rec;
  });
  const keptOld = lib.items.filter((i) => !isPlaceholder(i) && !newIds.has(i.id) && !renamedFrom.has(i.id));
  const removedItems = keptOld.map((i) => { const r = Object.assign({}, i, { removedIn: i.removedIn || v.id }); delete r.new; return r; });
  const purge = lib.items.filter((i) => isPlaceholder(i) && !newIds.has(i.id)).map((i) => i.id);
  const addedIds = first ? [] : p.added.filter((a) => !renamedTo.has(a.id)).map((a) => a.id);

  const next = Object.assign(emptyLibrary(), { rev: (lib.rev || 0) + 1, version: v.id, versionInfo: v, items: items.concat(removedItems), history: (lib.history || []).concat([{ version: v.id, at: new Date().toISOString(), added: addedIds.length, removed: p.removed.length, renames: renames.length }]).slice(-50) });

  // snapshot: old library + old icons are kept so the import can be undone
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), snap = path.join(snapRoot, stamp);
  if (backup) backup();
  fs.mkdirSync(snap, { recursive: true });
  let moved = false;
  try {
    writeAtomic(path.join(snap, 'library.json'), JSON.stringify(lib));
    writeAtomic(path.join(snap, 'meta.json'), JSON.stringify({ at: stamp, from: lib.version || '', to: v.id, renames, addedIds, purge }));
    if (fs.existsSync(itemsDir)) { moveDir(itemsDir, path.join(snap, 'items')); moved = true; }
    moveDir(staging, itemsDir);
    for (const r of removedItems) { // removed items keep their icon
      const from = path.join(snap, 'items', r.img), to = path.join(itemsDir, r.img);
      try { if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to); } catch (e) { /* icon stays missing */ }
    }
    writeAtomic(libFile, JSON.stringify(next));
  } catch (e) { // roll back so the app is never left half-imported
    try { if (moved) { fs.rmSync(itemsDir, { recursive: true, force: true }); moveDir(path.join(snap, 'items'), itemsDir); } fs.rmSync(snap, { recursive: true, force: true }); } catch (x) { /* best effort */ }
    throw e;
  }
  try { const all = fs.readdirSync(snapRoot).sort(); while (all.length > KEEP_SNAPSHOTS) fs.rmSync(path.join(snapRoot, all.shift()), { recursive: true, force: true }); } catch (e) { /* ignore */ }
  return { library: next, purge, renames, addedIds, summary: { version: v.id, relation: p.relation, added: addedIds.length, removed: p.removed.length, returned: p.returned, renamed: renames.length, failed: build.failed || [] } };
}

function latestSnapshot(dataDir) {
  const root = path.join(dataDir, 'snapshots');
  try {
    for (const n of fs.readdirSync(root).sort().reverse()) {
      const dir = path.join(root, n);
      try { const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8')); return { dir, meta }; } catch (e) { /* damaged snapshot, try older */ }
    }
  } catch (e) { /* none */ }
  return null;
}

function undo(dataDir) {
  const s = latestSnapshot(dataDir); if (!s) throw new Error('There is no import to undo.');
  const itemsDir = path.join(dataDir, 'items'), lib = JSON.parse(fs.readFileSync(path.join(s.dir, 'library.json'), 'utf8'));
  const old = path.join(s.dir, 'items');
  if (fs.existsSync(old)) { fs.rmSync(itemsDir, { recursive: true, force: true }); moveDir(old, itemsDir); } else fs.mkdirSync(itemsDir, { recursive: true });
  writeAtomic(path.join(dataDir, 'library.json'), JSON.stringify(lib));
  fs.rmSync(s.dir, { recursive: true, force: true });
  return { library: lib, meta: s.meta };
}

module.exports = { plan, commit, undo, latestSnapshot, relation };
