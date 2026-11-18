'use strict';
// Pulls the game's own look out of the player's jar into <data>/ui: the pixel font (as a generated TTF) and the creative-inventory tab sprites.
// Nothing from the game ships with the app; this runs on the player's machine from the player's own jar.
const fs = require('fs'), path = require('path');
const { Jar } = require('./zip'), png = require('./png'), { buildFont } = require('./ttf');
const G = 'assets/minecraft/textures/gui/sprites/container/creative_inventory/';
const TABS = { 'tab_sel.png': 'tab_top_selected_2.png', 'tab_off.png': 'tab_top_unselected_2.png', 'tab_sel_l.png': 'tab_top_selected_1.png', 'tab_off_l.png': 'tab_top_unselected_1.png' };

function fontGlyphs(jar) {
  const def = jar.json('assets/minecraft/font/include/default.json'), pr = (def.providers || []).find((p) => String(p.file).endsWith('font/ascii.png'));
  if (!pr) throw new Error('This jar has no ascii font sheet.');
  const img = png.decode(jar.read('assets/minecraft/textures/font/ascii.png')), cw = img.w / 16, chh = img.h / 16;
  if (cw !== 8 || chh !== 8) throw new Error('Unexpected font sheet size ' + img.w + 'x' + img.h + '.');
  const glyphs = [];
  pr.chars.forEach((row, r) => [...row].forEach((ch, c) => {
    const code = ch.codePointAt(0); if (!code || code > 0xfffe) return;
    const rows = new Array(8).fill(0); let w = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (img.data[((r * 8 + y) * img.w + c * 8 + x) * 4 + 3] > 0) { rows[y] |= 1 << x; if (x + 1 > w) w = x + 1; }
    glyphs.push({ code, w, adv: code === 32 ? 4 : w + 1, rows });
  }));
  if (!glyphs.some((g) => g.code === 32)) glyphs.push({ code: 32, w: 0, adv: 4, rows: new Array(8).fill(0) });
  return glyphs;
}

// Symbols the app uses that the game's ascii sheet does not have. Drawn here, in the same pixel style (row 0 = top, baseline after row 6).
const EXTRA = {
  0xb7: [3, ['#']], 0x2013: [3, ['####']], 0x2014: [3, ['######']],
  0x2018: [0, ['.#', '#.', '#.']], 0x2019: [0, ['.#', '.#', '#.']], 0x201c: [0, ['#.#', '#.#']], 0x201d: [0, ['#.#', '#.#']],
  0x2026: [6, ['#.#.#']], 0x22ef: [4, ['#.#.#']], 0x203a: [2, ['#.', '.#', '#.']],
  0x2192: [2, ['....#..', '.....#.', '#######', '.....#.', '....#..']],
  0x2713: [2, ['......#', '.....#.', '#...#..', '.#.#...', '..#....']],
  0x2715: [2, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']],
  0x2605: [1, ['..#..', '.###.', '#####', '.###.', '.#.#.']],
  0x25be: [3, ['#####', '.###.', '..#..']], 0x25bc: [3, ['#####', '.###.', '..#..']],
  0x25b4: [3, ['..#..', '.###.', '#####']], 0x25b2: [3, ['..#..', '.###.', '#####']],
  0x2298: [2, ['.###.', '#..##', '#.#.#', '##..#', '.###.']],
};
function addExtra(glyphs) {
  const have = new Set(glyphs.map((g) => g.code));
  for (const [k, [top, art]] of Object.entries(EXTRA)) {
    const code = Number(k); if (have.has(code)) continue;
    const rows = new Array(8).fill(0); let w = 0;
    art.forEach((line, i) => { for (let x = 0; x < line.length; x++) if (line[x] === '#') { rows[top + i] |= 1 << x; if (x + 1 > w) w = x + 1; } });
    glyphs.push({ code, w, adv: w + 1, rows });
  }
  return glyphs;
}

// Bump when what build() writes changes, so older data/ui folders are rebuilt at boot.
const LOOK_VERSION = 5;
const T = 'assets/minecraft/textures/';
const W = T + 'gui/sprites/widget/';
const BUTTONS = { 'btn.png': 'button.png', 'btn_hi.png': 'button_highlighted.png', 'btn_off.png': 'button_disabled.png' };

// Sprites are toned down to sit better on the app's dark theme: every colour is multiplied by k.
// keepWhite leaves near-white pixels alone (the highlighted button's outline must stay bright).
const TAB_DARK = 0.55, BTN_DARK = 0.8;
// Item frame drawn behind every item tile, as a PLACED frame looks from the front (not its inventory icon).
// The block model (template_item_frame) is a 12x12 square from (2,2) to (14,14): a 1-pixel border of the "wood" texture
// (birch planks) around a 10x10 "back" texture (item_frame, the leather). Front faces take the texture pixels at the same
// positions, so the frame is the 12x12 crop of the two textures combined. The item inside is drawn at 8/12 of the frame.
const FRAME_OPACITY = 0.6, FRAME_OPACITY_HOVER = 0.85;
function placedFrame(jar) {
  let wood = 'block/birch_planks', back = 'block/item_frame';
  try {
    const tx = jar.json('assets/minecraft/models/block/item_frame.json').textures || {};
    const clean = (v) => String(v).replace(/^minecraft:/, '');
    if (tx.wood && !String(tx.wood).startsWith('#')) wood = clean(tx.wood);
    if (tx.back && !String(tx.back).startsWith('#')) back = clean(tx.back);
  } catch (e) { /* use the defaults */ }
  if (!jar.has(T + wood + '.png') || !jar.has(T + back + '.png')) return null;
  const W = png.decode(jar.read(T + wood + '.png')), B = png.decode(jar.read(T + back + '.png'));
  const at = (img, x, y) => { const sx = Math.floor(x * img.w / 16), sy = Math.floor(y * img.w / 16) % img.h, i = (sy * img.w + sx) * 4; return img.data.slice(i, i + 4); };
  const out = Buffer.alloc(12 * 12 * 4);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const ring = x === 0 || y === 0 || x === 11 || y === 11;
    const p = at(ring ? W : B, x + 2, y + 2);
    out[(y * 12 + x) * 4] = p[0]; out[(y * 12 + x) * 4 + 1] = p[1]; out[(y * 12 + x) * 4 + 2] = p[2]; out[(y * 12 + x) * 4 + 3] = 255;
  }
  return { w: 12, h: 12, data: out };
}
// Bakes the opacity into the picture, so tiles can use it as a plain background (icon stays fully opaque).
function fade(img, a) {
  const d = { w: img.w, h: img.h, data: Buffer.from(img.data) };
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = Math.round(d.data[i] * a);
  return png.encode(d.w, d.h, d.data);
}
function darken(buf, k, keepWhite) {
  try {
    const d = png.decode(buf);
    for (let i = 0; i < d.data.length; i += 4) {
      if (keepWhite && d.data[i] >= 235 && d.data[i + 1] >= 235 && d.data[i + 2] >= 235) continue;
      d.data[i] = Math.round(d.data[i] * k); d.data[i + 1] = Math.round(d.data[i + 1] * k); d.data[i + 2] = Math.round(d.data[i + 2] * k);
    }
    return png.encode(d.w, d.h, d.data);
  } catch (e) { return buf; }
}

// The menu background. Current versions ship it ready-made (gui/menu_background.png). Older ones drew
// gui/options_background.png (and before that the dirt block) tinted 0x404040, so those are darkened the same way.
function menuBackground(jar) {
  if (jar.has(T + 'gui/menu_background.png')) return { src: 'menu_background', png: jar.read(T + 'gui/menu_background.png') };
  for (const [src, file] of [['options_background', T + 'gui/options_background.png'], ['dirt', T + 'block/dirt.png']]) {
    if (!jar.has(file)) continue;
    const d = png.decode(jar.read(file));
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.round(d.data[i] * 64 / 255); d.data[i + 1] = Math.round(d.data[i + 1] * 64 / 255); d.data[i + 2] = Math.round(d.data[i + 2] * 64 / 255); d.data[i + 3] = 255; }
    return { src, png: png.encode(d.w, d.h, d.data) };
  }
  return null;
}

// Nine-slice border of the button sprite, from its .mcmeta (3 in every version so far).
function buttonBorder(jar) {
  try {
    const b = jar.json(W + 'button.png.mcmeta').gui.scaling.border;
    const n = typeof b === 'number' ? b : Math.max(b.left || 0, b.top || 0, b.right || 0, b.bottom || 0);
    return n > 0 && n < 10 ? n : 3;
  } catch (e) { return 3; }
}

// Sounds are not in the jar: the launcher keeps them in <minecraft>/assets/objects, listed by an index file.
// Returns the path of the UI click sound on this machine, or null.
function findClickSound(jarPath) {
  const os = require('os'), home = os.homedir();
  const roots = [path.resolve(path.dirname(jarPath), '..', '..')];
  if (process.env.MCTIER_MC_VERSIONS) roots.push(path.resolve(process.env.MCTIER_MC_VERSIONS, '..'));
  if (process.platform === 'darwin') roots.push(path.join(home, 'Library/Application Support/minecraft'));
  else if (process.platform === 'win32') roots.push(path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), '.minecraft'));
  else roots.push(path.join(home, '.minecraft'));
  let wanted = null;
  try { wanted = JSON.parse(fs.readFileSync(jarPath.replace(/\.jar$/i, '.json'), 'utf8')).assetIndex.id; } catch (e) { /* jar was copied somewhere else */ }
  for (const root of roots) {
    const idxDir = path.join(root, 'assets', 'indexes');
    let names = []; try { names = fs.readdirSync(idxDir).filter((f) => f.endsWith('.json')); } catch (e) { continue; }
    names = names.map((f) => ({ f, t: fs.statSync(path.join(idxDir, f)).mtimeMs })).sort((x, y) => y.t - x.t).map((x) => x.f);
    if (wanted && names.includes(wanted + '.json')) names = [wanted + '.json', ...names.filter((f) => f !== wanted + '.json')];
    for (const f of names) {
      try {
        const o = JSON.parse(fs.readFileSync(path.join(idxDir, f), 'utf8')).objects['minecraft/sounds/random/click.ogg'];
        const file = o && /^[0-9a-f]{40}$/.test(o.hash) ? path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash) : null;
        if (file && fs.statSync(file).isFile()) return file;
      } catch (e) { /* try the next index */ }
    }
  }
  return null;
}

const NEEDED = ['mc.ttf', 'bg.png', 'tab_sel.png', 'tab_off.png', 'btn.png', 'btn_hi.png', 'look.json'];
// What is in <data>/ui right now. complete = nothing to rebuild.
function status(outDir) {
  const have = (f) => fs.existsSync(path.join(outDir, f));
  let info = null; try { info = JSON.parse(fs.readFileSync(path.join(outDir, 'look.json'), 'utf8')); } catch (e) { /* none yet */ }
  const missing = NEEDED.filter((f) => !have(f));
  return { ok: have('mc.ttf'), font: have('mc.ttf'), bg: have('bg.png'), tabs: have('tab_sel.png') && have('tab_off.png'), frame: have('frame.png'), buttons: have('btn.png') && have('btn_hi.png'), sound: have('click.ogg'),
    border: (info && info.border) || 3, complete: !missing.length && !!info && info.v === LOOK_VERSION, missing };
}

function build(jarPath, outDir) {
  const jar = new Jar(jarPath);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const font = buildFont(addExtra(fontGlyphs(jar)), 'Minecraft UI');
    fs.writeFileSync(path.join(outDir, 'mc.ttf'), font);
    const mb = menuBackground(jar);
    if (mb) fs.writeFileSync(path.join(outDir, 'bg.png'), mb.png);
    let tabs = 0;
    for (const [out, src] of Object.entries(TABS)) if (jar.has(G + src)) { fs.writeFileSync(path.join(outDir, out), darken(jar.read(G + src), TAB_DARK, false)); tabs++; }
    let buttons = 0;
    for (const [out, src] of Object.entries(BUTTONS)) if (jar.has(W + src)) { fs.writeFileSync(path.join(outDir, out), darken(jar.read(W + src), BTN_DARK, out === 'btn_hi.png')); buttons++; }
    const border = buttonBorder(jar);
    let frame = false;
    try {
      const fr = placedFrame(jar);
      if (fr) { fs.writeFileSync(path.join(outDir, 'frame.png'), fade(fr, FRAME_OPACITY)); fs.writeFileSync(path.join(outDir, 'frame_hi.png'), fade(fr, FRAME_OPACITY_HOVER)); frame = true; }
    } catch (e) { frame = false; }
    if (!frame) { for (const f of ['frame.png', 'frame_hi.png']) { try { fs.unlinkSync(path.join(outDir, f)); } catch (e) { /* not there */ } } }
    let sound = false;
    try { const click = findClickSound(jarPath); if (click) { fs.copyFileSync(click, path.join(outDir, 'click.ogg')); sound = true; } } catch (e) { /* silent buttons are fine */ }
    fs.writeFileSync(path.join(outDir, 'look.json'), JSON.stringify({ v: LOOK_VERSION, bg: mb ? mb.src : null, border, sound, frame }));
    return { ok: true, font: true, tabs, bg: !!mb, bgSource: mb ? mb.src : null, buttons, sound, frame };
  } finally { jar.close(); }
}
module.exports = { build, status, fontGlyphs, findClickSound, LOOK_VERSION };
