'use strict';
// Dependency-free PNG decode/encode (non-interlaced; all colour types and bit depths used by Minecraft assets).
const zlib = require('zlib');

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let CRC = null;
function crc32(buf) {
  if (!CRC) { CRC = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; } }
  let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0;
}

function decode(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('Not a PNG file');
  let p = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0, plte = null, trns = null; const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; il = data[12]; }
    else if (type === 'PLTE') plte = data; else if (type === 'tRNS') trns = data; else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
  }
  if (!w || !h || w * h > 64e6) throw new Error('Bad PNG size');
  if (il) throw new Error('Interlaced PNG not supported');
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]; if (!chan) throw new Error('Unknown PNG colour type');
  const bits = chan * bd, rb = Math.ceil(w * bits / 8), bpp = Math.max(1, bits >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat)); if (raw.length < (rb + 1) * h) throw new Error('Truncated PNG');
  const px = Buffer.alloc(rb * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (rb + 1)], src = y * (rb + 1) + 1, dst = y * rb;
    for (let x = 0; x < rb; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - rb + x] : 0, c = x >= bpp && y ? px[dst - rb + x - bpp] : 0; let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error('Bad PNG filter');
      px[dst + x] = v & 255;
    }
  }
  const out = new Uint8Array(w * h * 4), maxv = (1 << bd) - 1;
  const sample = (y, i) => { // i-th sample in row y
    const bitPos = i * bd, o = y * rb + (bitPos >> 3);
    if (bd === 8) return px[o]; if (bd === 16) return px[o]; // 16-bit: keep the high byte
    return (px[o] >> (8 - bd - (bitPos & 7))) & maxv;
  };
  const scale = bd < 8 ? 255 / maxv : 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; let r, g, b, a = 255;
    if (ct === 3) { const i = sample(y, x); if (!plte || i * 3 + 2 >= plte.length) throw new Error('Bad palette'); r = plte[i * 3]; g = plte[i * 3 + 1]; b = plte[i * 3 + 2]; if (trns && i < trns.length) a = trns[i]; }
    else if (ct === 0) { const v = sample(y, x); r = g = b = bd < 8 ? Math.round(v * scale) : v; if (trns && trns.length >= 2 && (bd === 16 ? trns[0] === v : trns.readUInt16BE(0) === v)) a = 0; }
    else if (ct === 4) { const k = x * 2; r = g = b = sample(y, k); a = sample(y, k + 1); }
    else if (ct === 2) { const k = x * 3; r = sample(y, k); g = sample(y, k + 1); b = sample(y, k + 2); }
    else { const k = x * 4; r = sample(y, k); g = sample(y, k + 1); b = sample(y, k + 2); a = sample(y, k + 3); }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return { w, h, data: out };
}

function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b;
}
function encode(w, h, rgba) {
  const rb = w * 4, raw = Buffer.alloc((rb + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (rb + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * rb, rb).copy(raw, y * (rb + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { decode, encode, crc32 };
