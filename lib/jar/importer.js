'use strict';
// Reads a Minecraft client jar and produces the item library: names, tags, generated variants and icons.
// Pure Node (no Electron) so it runs in a worker thread and in headless tests.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Jar } = require('./zip');
const { IconRenderer, png, potionColors } = require('./render');
const { makeName } = require('../items');

const ITEMS = 'assets/minecraft/items/';
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const POTION_KINDS = [['potion', 'potion'], ['splash_potion', 'splash_potion'], ['lingering_potion', 'lingering_potion'], ['tipped_arrow', 'tipped_arrow']];

function openJar(file) {
  let st; try { st = fs.statSync(file); } catch (e) { throw new Error('That file could not be opened.'); }
  if (!st.isFile() || st.size < 1e6) throw new Error('That does not look like a Minecraft jar (too small).');
  try { return new Jar(file); } catch (e) { throw new Error('That file is not a readable jar/zip archive (' + e.message + ').'); }
}

// Quick look: is this a usable jar, what version is it, and which items does it hold?
function inspect(file) {
  const jar = openJar(file);
  try {
    if (!jar.list(ITEMS).length) throw new Error('This jar has no item definitions (assets/minecraft/items). It is either older than Minecraft 1.21.4 or not a game client jar.');
    if (!jar.has('assets/minecraft/lang/en_us.json')) throw new Error('This jar has no English language file, so item names cannot be read.');
    if (!jar.list('assets/minecraft/models/').length || !jar.list('assets/minecraft/textures/').length) throw new Error('This jar is missing its models or textures, so icons cannot be drawn.');
    let ver = {}; try { ver = jar.json('version.json'); } catch (e) { /* older layouts */ }
    const ids = itemIds(jar);
    const name = String(ver.name || ver.id || '').trim() || path.basename(file, '.jar');
    return { ok: true, version: { id: String(ver.id || name), name, world: ver.world_version || null, built: ver.build_time || null }, ids, jarPath: file };
  } finally { jar.close(); }
}

const itemIds = (jar) => jar.list(ITEMS).filter((f) => f.endsWith('.json')).map((f) => f.slice(ITEMS.length, -5)).filter((id) => id !== 'air' && !id.includes('/')).sort();

// ---- tags (raw file names, nested #references expanded) ----
function readTags(jar, itemSet) {
  const base = 'data/minecraft/tags/item/', files = jar.list(base).filter((f) => f.endsWith('.json')), raw = new Map();
  for (const f of files) { try { raw.set(f.slice(base.length, -5), jar.json(f)); } catch (e) { /* skip unreadable tag */ } }
  const memo = new Map();
  const expand = (name, stack) => {
    if (memo.has(name)) return memo.get(name); if (stack.has(name) || !raw.has(name)) return new Set();
    stack.add(name); const out = new Set();
    for (const v of raw.get(name).values || []) {
      const s = typeof v === 'string' ? v : v && v.id; if (typeof s !== 'string') continue;
      if (s.startsWith('#')) { const ref = s.slice(1).replace(/^minecraft:/, ''); for (const x of expand(ref, stack)) out.add(x); }
      else { const id = s.replace(/^minecraft:/, ''); if (itemSet.has(id)) out.add(id); }
    }
    stack.delete(name); memo.set(name, out); return out;
  };
  const byItem = new Map(), counts = {};
  for (const name of raw.keys()) {
    const members = expand(name, new Set()); if (!members.size) continue; const tag = '#minecraft:' + name; counts[tag] = members.size;
    for (const id of members) { if (!byItem.has(id)) byItem.set(id, []); byItem.get(id).push(tag); }
  }
  for (const list of byItem.values()) list.sort();
  return { byItem, counts };
}

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
function missingIcon() {
  const d = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const m = ((x >> 3) + (y >> 3)) & 1, o = (y * 16 + x) * 4; d[o] = m ? 0 : 248; d[o + 1] = 0; d[o + 2] = m ? 0 : 248; d[o + 3] = 255; }
  return png.encode(16, 16, d);
}

// Renders everything. opts: { jarPath, outDir }. onProgress({phase, done, total, name})
function build(opts, onProgress) {
  const progress = onProgress || (() => {});
  const info = inspect(opts.jarPath), jar = openJar(opts.jarPath);
  try {
    fs.mkdirSync(opts.outDir, { recursive: true });
    const lang = jar.json('assets/minecraft/lang/en_us.json'), ids = info.ids, idSet = new Set(ids);
    const { byItem, counts } = readTags(jar, idSet), R = new IconRenderer(jar);
    let pc = {}; try { pc = potionColors(R.S.vm).potionColors; } catch (e) { /* potions fall back to the default colour */ }

    // plan: every real item, then generated variants
    const plan = ids.map((id) => ({ id, name: lang['item.minecraft.' + id] || lang['block.minecraft.' + id] || makeName(id), real: true }));
    const potTypes = [...Object.keys(pc), 'empty'].filter((t) => lang['item.minecraft.potion.effect.' + t]);
    if (idSet.has('potion')) for (const [kind, key] of POTION_KINDS) if (idSet.has(kind)) for (const t of potTypes) plan.push({ id: kind + '_' + t, name: lang['item.minecraft.' + key + '.effect.' + t], gen: kind, base: kind, tint: t === 'empty' ? 0x385DC6 : pc[t] });
    if (idSet.has('enchanted_book')) {
      for (const f of jar.list('data/minecraft/enchantment/').filter((x) => x.endsWith('.json')).sort()) {
        const e = f.split('/').pop().slice(0, -5), nm = lang['enchantment.minecraft.' + e]; if (!nm) continue;
        let mx = 1; try { mx = jar.json(f).max_level || 1; } catch (x) { /* keep 1 */ }
        plan.push({ id: 'enchanted_book_' + e, name: (lang['item.minecraft.enchanted_book'] || 'Enchanted Book') + ' (' + nm + (mx > 1 ? ' ' + (ROMAN[mx] || mx) : '') + ')', gen: 'enchanted_book', base: 'enchanted_book', share: 'enchanted_book' });
      }
    }

    const items = [], failed = [], hashes = new Map(); let done = 0, wroteMissing = false;
    for (const p of plan) {
      progress({ phase: 'icons', done, total: plan.length, name: p.name });
      let rec = { id: p.id, name: p.name, img: p.id + '.png', tags: byItem.get(p.base || p.id) || [] };
      if (p.gen) rec.gen = p.gen;
      try {
        if (p.share) { rec.img = p.share + '.png'; rec.h = hashes.get(p.share); }
        else {
          const im = p.tint != null ? R.tinted(p.base, [(p.tint >> 16) & 255, (p.tint >> 8) & 255, p.tint & 255]) : R.item(p.id), buf = png.encode(im.w, im.h, im.data);
          fs.writeFileSync(path.join(opts.outDir, p.id + '.png'), buf); rec.h = sha(buf); hashes.set(p.id, rec.h);
        }
      } catch (e) {
        failed.push({ id: p.id, name: p.name, error: String(e.message || e) });
        if (!wroteMissing) { fs.writeFileSync(path.join(opts.outDir, '_missing.png'), missingIcon()); wroteMissing = true; }
        rec.img = '_missing.png'; rec.noIcon = true;
      }
      items.push(rec); done++;
    }
    progress({ phase: 'icons', done, total: plan.length, name: '' });
    return { version: info.version, items, failed, tagCounts: counts };
  } finally { jar.close(); }
}

module.exports = { inspect, build, readTags, itemIds };
