'use strict';
// Minimal read-only ZIP/JAR reader (central directory + stored/deflate). No dependencies.
const fs = require('fs'), zlib = require('zlib');
class Jar {
  constructor(path) {
    this.path = path; this.fd = fs.openSync(path, 'r'); this.size = fs.fstatSync(this.fd).size; this.entries = new Map();
    const tailLen = Math.min(this.size, 65557), tail = Buffer.alloc(tailLen);
    fs.readSync(this.fd, tail, 0, tailLen, this.size - tailLen);
    let e = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Not a zip/jar file (no end-of-central-directory record).');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdOff === 0xffffffff) throw new Error('ZIP64 archives are not supported.');
    const cd = Buffer.alloc(cdSize); fs.readSync(this.fd, cd, 0, cdSize, cdOff);
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt central directory.');
      const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), lho = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nlen);
      if (!name.endsWith('/')) this.entries.set(name, { method, csize, usize, lho });
      p += 46 + nlen + xlen + clen;
    }
  }
  has(n) { return this.entries.has(n); }
  list(prefix = '') { return [...this.entries.keys()].filter(k => k.startsWith(prefix)); }
  read(name) {
    const en = this.entries.get(name); if (!en) throw new Error('Missing in jar: ' + name);
    const h = Buffer.alloc(30); fs.readSync(this.fd, h, 0, 30, en.lho);
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('Corrupt local header for ' + name);
    const start = en.lho + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    const raw = Buffer.alloc(en.csize); fs.readSync(this.fd, raw, 0, en.csize, start);
    return en.method === 0 ? raw : zlib.inflateRawSync(raw);
  }
  json(name) { return JSON.parse(this.read(name).toString('utf8')); }
  close() { try { fs.closeSync(this.fd); } catch (_) {} }
}
module.exports = { Jar };
