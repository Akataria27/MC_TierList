'use strict';
// Builds a TrueType font from the game's bitmap font (ascii.png), pixel by pixel. No dependencies.
// 1 game pixel = 100 font units and the em is 8 pixels, so at font-size 16px every game pixel is exactly 2 screen pixels.
const PX = 100, UPM = 800, ASC = 700, DESC = -100;

function rectsOf(rows, w) { // rows: array of 8 numbers (bit x set = pixel at column x). Returns merged horizontal runs.
  const out = [];
  for (let r = 0; r < 8; r++) {
    let x = 0;
    while (x < w) {
      if (!((rows[r] >> x) & 1)) { x++; continue; }
      let e = x; while (e < w && ((rows[r] >> e) & 1)) e++;
      out.push([x * PX, (7 - r - 1) * PX, e * PX, (7 - r) * PX]); x = e;
    }
  }
  return out;
}

function glyphBytes(rects) {
  if (!rects.length) return { buf: Buffer.alloc(0), bbox: [0, 0, 0, 0] };
  const n = rects.length * 4, xs = [], ys = [];
  const bbox = [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))];
  const pts = []; for (const [x0, y0, x1, y1] of rects) pts.push([x0, y0], [x0, y1], [x1, y1], [x1, y0]); // clockwise
  let px = 0, py = 0; for (const [x, y] of pts) { xs.push(x - px); ys.push(y - py); px = x; py = y; }
  const len = 10 + rects.length * 2 + 2 + n + n * 2 + n * 2, b = Buffer.alloc(len + (len & 1));
  let o = 0; b.writeInt16BE(rects.length, o); o += 2; for (const v of bbox) { b.writeInt16BE(v, o); o += 2; }
  for (let i = 0; i < rects.length; i++) { b.writeUInt16BE(i * 4 + 3, o); o += 2; }
  b.writeUInt16BE(0, o); o += 2;
  for (let i = 0; i < n; i++) b[o++] = 1;
  for (const v of xs) { b.writeInt16BE(v, o); o += 2; }
  for (const v of ys) { b.writeInt16BE(v, o); o += 2; }
  return { buf: b, bbox };
}

const sum32 = (buf) => { let s = 0; const p = Buffer.concat([buf, Buffer.alloc((4 - (buf.length & 3)) & 3)]); for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; };

// glyphs: [{ code, adv (pixels, including the 1px gap), w (ink width), rows[8] }]
function buildFont(glyphs, name) {
  const list = [{ code: null, adv: 5, w: 0, rows: new Array(8).fill(0) }].concat(glyphs.slice().sort((a, b) => a.code - b.code));
  const nG = list.length, built = list.map((g) => glyphBytes(rectsOf(g.rows, g.w)));
  const glyf = Buffer.concat(built.map((b) => b.buf)), loca = Buffer.alloc((nG + 1) * 4);
  let off = 0; built.forEach((b, i) => { loca.writeUInt32BE(off, i * 4); off += b.buf.length; }); loca.writeUInt32BE(off, nG * 4);
  const hmtx = Buffer.alloc(nG * 4); let advMax = 0, minLsb = 1e9, xMax = 0;
  list.forEach((g, i) => { const adv = g.adv * PX, lsb = built[i].buf.length ? built[i].bbox[0] : 0; hmtx.writeUInt16BE(adv, i * 4); hmtx.writeInt16BE(lsb, i * 4 + 2); advMax = Math.max(advMax, adv); if (built[i].buf.length) { minLsb = Math.min(minLsb, lsb); xMax = Math.max(xMax, built[i].bbox[2]); } });
  if (minLsb === 1e9) minLsb = 0;

  const codes = list.slice(1).map((g) => g.code).filter((c) => c < 0xffff);
  const segs = codes.map((c) => ({ c, gi: list.findIndex((g) => g.code === c) }));
  const segN = segs.length + 1, cm = Buffer.alloc(16 + segN * 8);
  cm.writeUInt16BE(4, 0); cm.writeUInt16BE(cm.length, 2); cm.writeUInt16BE(0, 4); cm.writeUInt16BE(segN * 2, 6);
  let sr = 1, es = 0; while (sr * 2 <= segN) { sr *= 2; es++; }
  cm.writeUInt16BE(sr * 2, 8); cm.writeUInt16BE(es, 10); cm.writeUInt16BE(segN * 2 - sr * 2, 12);
  let o = 14; for (const s of segs) { cm.writeUInt16BE(s.c, o); o += 2; } cm.writeUInt16BE(0xffff, o); o += 2; o += 2; // endCode + reservedPad
  for (const s of segs) { cm.writeUInt16BE(s.c, o); o += 2; } cm.writeUInt16BE(0xffff, o); o += 2;
  for (const s of segs) { cm.writeUInt16BE((s.gi - s.c) & 0xffff, o); o += 2; } cm.writeUInt16BE(1, o); o += 2;
  for (let i = 0; i < segN; i++) { cm.writeUInt16BE(0, o); o += 2; }
  const cmap = Buffer.alloc(12 + cm.length); cmap.writeUInt16BE(0, 0); cmap.writeUInt16BE(1, 2); cmap.writeUInt16BE(3, 4); cmap.writeUInt16BE(1, 6); cmap.writeUInt32BE(12, 8); cm.copy(cmap, 12);

  const head = Buffer.alloc(54); head.writeUInt32BE(0x00010000, 0); head.writeUInt32BE(0x00010000, 4); head.writeUInt32BE(0, 8); head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(0x0003, 16); head.writeUInt32BE(3850000000, 24); head.writeUInt32BE(3850000000, 32); head.writeUInt16BE(UPM, 18); head.writeInt16BE(0, 36); head.writeInt16BE(-PX, 38); head.writeInt16BE(xMax, 40); head.writeInt16BE(ASC, 42);
  head.writeUInt16BE(0, 44); head.writeUInt16BE(8, 46); head.writeInt16BE(2, 48); head.writeInt16BE(1, 50); head.writeInt16BE(0, 52);
  const hhea = Buffer.alloc(36); hhea.writeUInt32BE(0x00010000, 0); hhea.writeInt16BE(ASC, 4); hhea.writeInt16BE(DESC, 6); hhea.writeInt16BE(0, 8); hhea.writeUInt16BE(advMax, 10); hhea.writeInt16BE(minLsb, 12); hhea.writeInt16BE(0, 14); hhea.writeInt16BE(xMax, 16);
  hhea.writeInt16BE(1, 18); hhea.writeInt16BE(0, 20); hhea.writeUInt16BE(nG, 34);
  const maxp = Buffer.alloc(32); maxp.writeUInt32BE(0x00010000, 0); maxp.writeUInt16BE(nG, 4); maxp.writeUInt16BE(400, 6); maxp.writeUInt16BE(64, 8); maxp.writeUInt16BE(40, 10); maxp.writeUInt16BE(4, 12); maxp.writeUInt16BE(1, 14); maxp.writeUInt16BE(0, 16); maxp.writeUInt16BE(0, 18); maxp.writeUInt16BE(0, 20); maxp.writeUInt16BE(0, 22); maxp.writeUInt16BE(0, 24); maxp.writeUInt16BE(0, 26); maxp.writeUInt16BE(0, 28); maxp.writeUInt16BE(0, 30);
  const os2 = Buffer.alloc(78); os2.writeUInt16BE(1, 0); os2.writeInt16BE(Math.round(advMax / 2), 2); os2.writeUInt16BE(400, 4); os2.writeUInt16BE(5, 6); os2.writeUInt16BE(0, 8);
  os2.writeInt16BE(400, 10); os2.writeInt16BE(400, 12); os2.writeInt16BE(0, 14); os2.writeInt16BE(300, 16); os2.writeInt16BE(400, 18); os2.writeInt16BE(400, 20); os2.writeInt16BE(0, 22); os2.writeInt16BE(250, 24); os2.writeInt16BE(0, 26); os2.writeInt16BE(0, 28);
  os2.writeUInt32BE(1, 42); os2.write('MCUI', 58, 'latin1'); os2.writeUInt16BE(0x40, 62); os2.writeUInt16BE(codes[0] || 32, 64); os2.writeUInt16BE(codes[codes.length - 1] || 126, 66);
  os2.writeInt16BE(ASC, 68); os2.writeInt16BE(DESC, 70); os2.writeInt16BE(0, 72); os2.writeUInt16BE(ASC, 74); os2.writeUInt16BE(-DESC, 76);
  const post = Buffer.alloc(32); post.writeUInt32BE(0x00030000, 0); post.writeUInt32BE(1, 12);
  const nm = Buffer.from(name, 'utf16le').swap16(), strs = [[1, name], [2, 'Regular'], [3, name], [4, name], [6, name.replace(/\s/g, '')]];
  const nameT = Buffer.alloc(6 + strs.length * 12 + strs.length * nm.length); nameT.writeUInt16BE(0, 0); nameT.writeUInt16BE(strs.length, 2); nameT.writeUInt16BE(6 + strs.length * 12, 4);
  let so = 0; strs.forEach(([id, s], i) => { const b = Buffer.from(s, 'utf16le').swap16(), r = 6 + i * 12; nameT.writeUInt16BE(3, r); nameT.writeUInt16BE(1, r + 2); nameT.writeUInt16BE(0x409, r + 4); nameT.writeUInt16BE(id, r + 6); nameT.writeUInt16BE(b.length, r + 8); nameT.writeUInt16BE(so, r + 10); b.copy(nameT, 6 + strs.length * 12 + so); so += b.length; });
  const nameBuf = nameT.subarray(0, 6 + strs.length * 12 + so);

  const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name: nameBuf, post };
  const tags = Object.keys(tables).sort(), dirLen = 12 + tags.length * 16; let pos = dirLen;
  const dir = Buffer.alloc(dirLen); dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(tags.length, 4);
  let p2 = 1, l2 = 0; while (p2 * 2 <= tags.length) { p2 *= 2; l2++; } dir.writeUInt16BE(p2 * 16, 6); dir.writeUInt16BE(l2, 8); dir.writeUInt16BE(tags.length * 16 - p2 * 16, 10);
  const parts = [dir]; let headAt = 0;
  tags.forEach((t, i) => { const b = tables[t], r = 12 + i * 16, pad = (4 - (b.length & 3)) & 3; dir.write(t, r, 'latin1'); dir.writeUInt32BE(sum32(b), r + 4); dir.writeUInt32BE(pos, r + 8); dir.writeUInt32BE(b.length, r + 12); if (t === 'head') headAt = pos; parts.push(b, Buffer.alloc(pad)); pos += b.length + pad; });
  const font = Buffer.concat(parts); font.writeUInt32BE((0xb1b0afba - sum32(font)) >>> 0, headAt + 8); return font;
}
module.exports = { buildFont };
