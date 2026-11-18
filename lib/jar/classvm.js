'use strict';
// Reads Minecraft's compiled model classes straight from the jar (no Java needed) and runs the static
// model-builder methods (createBodyLayer etc.) in a tiny interpreter to recover boxes, UVs, poses.
function parseClass(buf) {
  if (buf.readUInt32BE(0) !== 0xCAFEBABE) throw new Error('Not a class file');
  let p = 8; const n = buf.readUInt16BE(p); p += 2; const cp = new Array(n);
  for (let i = 1; i < n; i++) {
    const t = buf[p++];
    switch (t) {
      case 1: { const l = buf.readUInt16BE(p); cp[i] = { t, s: buf.toString('utf8', p + 2, p + 2 + l) }; p += 2 + l; break; }
      case 3: cp[i] = { t, v: buf.readInt32BE(p) }; p += 4; break;
      case 4: cp[i] = { t, v: buf.readFloatBE(p) }; p += 4; break;
      case 5: cp[i] = { t, v: Number(buf.readBigInt64BE(p)) }; p += 8; i++; break;
      case 6: cp[i] = { t, v: buf.readDoubleBE(p) }; p += 8; i++; break;
      case 7: case 8: case 16: case 19: case 20: cp[i] = { t, a: buf.readUInt16BE(p) }; p += 2; break;
      case 9: case 10: case 11: case 12: case 17: case 18: cp[i] = { t, a: buf.readUInt16BE(p), b: buf.readUInt16BE(p + 2) }; p += 4; break;
      case 15: cp[i] = { t, k: buf[p], a: buf.readUInt16BE(p + 1) }; p += 3; break;
      default: throw new Error('Unknown constant pool tag ' + t);
    }
  }
  const utf = i => cp[i].s;
  const superName = buf.readUInt16BE(p + 4) ? cp[cp[buf.readUInt16BE(p + 4)].a].s : null;
  p += 6; const ni = buf.readUInt16BE(p); p += 2 + ni * 2;
  const skipAttrs = () => { const c = buf.readUInt16BE(p); p += 2; for (let i = 0; i < c; i++) { p += 2; const l = buf.readUInt32BE(p); p += 4 + l; } };
  let fc = buf.readUInt16BE(p); p += 2; for (let i = 0; i < fc; i++) { p += 6; skipAttrs(); }
  const mc = buf.readUInt16BE(p); p += 2; const methods = [];
  for (let i = 0; i < mc; i++) {
    const name = utf(buf.readUInt16BE(p + 2)), desc = utf(buf.readUInt16BE(p + 4)); p += 6;
    const ac = buf.readUInt16BE(p); p += 2; let code = null;
    for (let j = 0; j < ac; j++) {
      const an = utf(buf.readUInt16BE(p)), al = buf.readUInt32BE(p + 2); p += 6;
      if (an === 'Code') { const cl = buf.readUInt32BE(p + 4); code = buf.subarray(p + 8, p + 8 + cl); }
      p += al;
    }
    methods.push({ name, desc, code });
  }
  return { cp, methods, superName };
}
const ref = (cls, i) => { const e = cls.cp[i], nt = cls.cp[e.b]; return { cls: cls.cp[cls.cp[e.a].a].s, name: cls.cp[nt.a].s, desc: cls.cp[nt.b].s }; };
function descArgs(desc) {
  const inner = desc.slice(1, desc.indexOf(')')), r = []; let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c === 'L') { const j = inner.indexOf(';', i); r.push('L:' + inner.slice(i + 1, j).split('/').pop()); i = j + 1; }
    else if (c === '[') i++; else { r.push(c); i++; }
  }
  return r;
}
function decode(cls, code) {
  const out = []; let p = 0;
  const u1 = () => code[p++], s1 = () => (code[p++] << 24) >> 24, u2 = () => { const v = code.readUInt16BE(p); p += 2; return v; }, s2 = () => { const v = code.readInt16BE(p); p += 2; return v; };
  while (p < code.length) {
    const off = p, o = u1(); let op, a;
    if (o >= 0x2a && o <= 0x2d) op = ['aload', o - 0x2a]; else if (o >= 0x1a && o <= 0x1d) op = ['aload', o - 0x1a]; else if (o >= 0x22 && o <= 0x25) op = ['aload', o - 0x22];
    else if (o === 0x19 || o === 0x15 || o === 0x17) op = ['aload', u1()];
    else if (o >= 0x4b && o <= 0x4e) op = ['astore', o - 0x4b]; else if (o >= 0x3b && o <= 0x3e) op = ['astore', o - 0x3b]; else if (o >= 0x43 && o <= 0x46) op = ['astore', o - 0x43];
    else if (o === 0x3a || o === 0x36 || o === 0x38) op = ['astore', u1()];
    else if (o === 0x59) op = ['dup']; else if (o === 0x57) op = ['pop'];
    else if (o === 0x02) op = ['const', -1]; else if (o >= 0x03 && o <= 0x08) op = ['const', o - 3]; else if (o >= 0x0b && o <= 0x0d) op = ['const', o - 0x0b];
    else if (o === 0x10) op = ['const', s1()]; else if (o === 0x11) op = ['const', s2()];
    else if (o === 0x12 || o === 0x13 || o === 0x14) { const i = o === 0x12 ? u1() : u2(); const e = cls.cp[i]; op = ['const', e.t === 8 ? cls.cp[e.a].s : e.v]; }
    else if (o === 0x76) op = ['fneg']; else if (o === 0x62) op = ['fadd']; else if (o === 0x66) op = ['fsub']; else if (o === 0x6a) op = ['fmul']; else if (o === 0x6e) op = ['fdiv'];
    else if (o === 0x86) op = ['i2f'];
    else if (o === 0x99) op = ['ifeq', off + s2()]; else if (o === 0x9a) op = ['ifne', off + s2()]; else if (o === 0xa7) op = ['goto', off + s2()];
    else if (o === 0xc0) { u2(); op = ['nop']; }
    else if (o === 0xb3) op = ['putstatic', ref(cls, u2())];
    else if (o === 0xb2) op = ['getstatic', ref(cls, u2())]; else if (o === 0xbb) op = ['new', cls.cp[cls.cp[u2()].a].s];
    else if (o === 0xba) { u2(); p += 2; op = ['indy']; }
    else if (o === 0xb1) op = ['return']; else if (o === 0xb0 || o === 0xac) op = ['areturn'];
    else if (o >= 0xb6 && o <= 0xb9) { const r = ref(cls, u2()); if (o === 0xb9) p += 2; op = ['invoke', r, o === 0xb8]; }
    else if (o === 0xaa || o === 0xab || o === 0xc4) throw new Error('Unsupported opcode 0x' + o.toString(16) + ' at ' + off);
    else { const two = [0x10,0x12,0x15,0x16,0x17,0x18,0x19,0x36,0x37,0x38,0x39,0x3a,0xa9,0xbc], three = [0x11,0x13,0x14,0x84,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xbb,0xbd,0xc0,0xc1,0xc6,0xc7];
      p += two.includes(o) ? 1 : (three.includes(o) || (o >= 0x99 && o <= 0xa8)) ? 2 : (o === 0xb9 || o === 0xba || o === 0xc8 || o === 0xc9) ? 4 : o === 0xc5 ? 3 : 0; op = ['skip', o]; }
    out.push({ off, op });
  }
  return out;
}
class Vm {
  constructor(loadClass) { this.loadClass = loadClass; this.cache = new Map(); }
  cls(name) { if (!this.cache.has(name)) this.cache.set(name, parseClass(this.loadClass(name))); return this.cache.get(name); }
  method(clsName, name, desc) {
    let cn = clsName;
    while (cn) {                                   // static methods may be inherited (PiglinModel -> AbstractPiglinModel)
      const c = this.cls(cn), m = c.methods.find(m => m.name === name && (!desc || m.desc === desc));
      if (m && m.code) return { c, code: m.code, desc: m.desc };
      cn = c.superName && /^net\/minecraft\//.test(c.superName) ? c.superName : null;
    }
    throw new Error('No method ' + clsName + '.' + name);
  }
  call(clsName, name, args = [], desc) {
    const { c, code, desc: d } = this.method(clsName, name, desc);
    return this.exec(c, decode(c, code), args);
  }
  exec(cls, ins, args) {
    const at = new Map(ins.map((x, i) => [x.off, i])), st = [], loc = {}; args.forEach((a, i) => loc[i] = a);
    let i = 0, steps = 0;
    while (i < ins.length) {
      if (++steps > 50000) throw new Error('runaway');
      const [op, a, b] = ins[i++].op;
      switch (op) {
        case 'aload': st.push(loc[a]); break; case 'astore': loc[a] = st.pop(); break;
        case 'dup': st.push(st[st.length - 1]); break; case 'pop': st.pop(); break; case 'const': st.push(a); break;
        case 'fneg': st.push(-st.pop()); break; case 'i2f': break; case 'nop': break;
        case 'fadd': { const y = st.pop(), x = st.pop(); st.push(x + y); break; } case 'fsub': { const y = st.pop(), x = st.pop(); st.push(x - y); break; }
        case 'fmul': { const y = st.pop(), x = st.pop(); st.push(x * y); break; } case 'fdiv': { const y = st.pop(), x = st.pop(); st.push(y ? x / y : 0); break; }
        case 'ifeq': if (!st.pop()) i = at.get(a); break; case 'ifne': if (st.pop()) i = at.get(a); break; case 'goto': i = at.get(a); break;
        case 'putstatic': st.pop(); break;
        case 'skip': throw new Error('Unsupported opcode 0x' + a.toString(16));
        case 'getstatic': { const n = a.name, c = a.cls.split('/').pop();
          if (n === 'NONE' && c === 'CubeDeformation') st.push({ k: 'deform', g: 0 }); else if (n === 'ZERO' && c === 'PartPose') st.push({ k: 'pose', t: [0, 0, 0], r: [0, 0, 0] }); else st.push({ k: 'static', name: a.cls + '.' + n }); break; }
        case 'new': st.push({ k: 'new', cls: a.split('/').pop() }); break;
        case 'indy': st.push({ k: 'lambda' }); break;
        case 'return': return null; case 'areturn': return st.pop();
        case 'invoke': { const ar = descArgs(a.desc), vals = []; for (let j = 0; j < ar.length; j++) vals.unshift(st.pop());
          const recv = b ? null : st.pop(); const r = this.invoke(a, ar, vals, recv, b); if (!a.desc.endsWith(')V')) st.push(r); break; }
      }
    }
    return null;
  }
  invoke(a, ar, vals, recv, isStatic) {
    const cls = a.cls.split('/').pop(), name = a.name;
    if (name === '<init>') {
      if (cls === 'CubeDeformation') { recv.k = 'deform'; recv.g = vals.length ? vals[0] : 0; recv.extra = vals; }
      else if (cls === 'MeshDefinition') { recv.k = 'mesh'; recv.root = { k: 'part', name: 'root', pose: { t: [0, 0, 0], r: [0, 0, 0] }, boxes: [], children: [] }; }
      return null;
    }
    if (cls === 'CubeListBuilder') {
      if (name === 'create') return { k: 'clb', boxes: [], uv: [0, 0], mirror: false };
      if (name === 'texOffs') { recv.uv = [vals[0], vals[1]]; return recv; }
      if (name === 'mirror') { recv.mirror = vals.length ? !!vals[0] : true; return recv; }
      if (name === 'addBox') {
        const fl = vals.filter((v, i) => ar[i] === 'F'), ints = vals.filter((v, i) => ar[i] === 'I'), de = vals.filter((v, i) => ar[i] === 'L:CubeDeformation');
        if (fl.length === 3 && ints.length === 5) recv.boxes.push({ uv: [ints[3], ints[4]], box: [...fl, ints[0], ints[1], ints[2]], grow: 0, mirror: recv.mirror });
        else recv.boxes.push({ uv: [...recv.uv], box: fl.slice(0, 6), grow: de.length ? de[0].g : 0, mirror: recv.mirror });
        return recv;
      }
      return recv;
    }
    if (cls === 'PartPose') {
      if (name === 'offset') return { k: 'pose', t: vals.slice(0, 3), r: [0, 0, 0] };
      if (name === 'offsetAndRotation') return { k: 'pose', t: vals.slice(0, 3), r: vals.slice(3, 6) };
      if (name === 'rotation') return { k: 'pose', t: [0, 0, 0], r: vals.slice(0, 3) };
      if (name === 'translated') return { k: 'pose', t: [recv.t[0] + vals[0], recv.t[1] + vals[1], recv.t[2] + vals[2]], r: recv.r };
      return recv;
    }
    if (cls === 'MeshDefinition') return name === 'getRoot' ? recv.root : recv;
    if (cls === 'PartDefinition' && name === 'addOrReplaceChild') { const ch = { k: 'part', name: vals[0], pose: vals[2], boxes: vals[1].boxes, children: [] }; recv.children.push(ch); return ch; }
    if (cls === 'PartDefinition' && name === 'getChild') return recv.children.find(c => c.name === vals[0]) || null;
    if (cls === 'LayerDefinition' && name === 'create') return { k: 'layer', mesh: vals[0], size: [vals[1], vals[2]] };
    if (cls === 'CubeDeformation' && name === 'extend') return { k: 'deform', g: recv.g + vals[0] };
    if (isStatic && /^net\/minecraft\//.test(a.cls) && !/\/(geom\/builders)\//.test(a.cls)) return this.call(a.cls, a.name, vals, a.desc);   // e.g. AbstractPiglinModel.addHead
    return null;
  }
}
const mulM = (A, B) => { const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return r; };
const Rzyx = (rx, ry, rz) => { const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  return mulM(mulM([cz, -sz, 0, sz, cz, 0, 0, 0, 1], [cy, 0, sy, 0, 1, 0, -sy, 0, cy]), [1, 0, 0, 0, cx, -sx, 0, sx, cx]); };
function flatten(part, pt = [0, 0, 0], pM = [1, 0, 0, 0, 1, 0, 0, 0, 1], out = [], path = '') {
  const o = part.pose.t, t = [pt[0] + pM[0] * o[0] + pM[1] * o[1] + pM[2] * o[2], pt[1] + pM[3] * o[0] + pM[4] * o[1] + pM[5] * o[2], pt[2] + pM[6] * o[0] + pM[7] * o[1] + pM[8] * o[2]];
  const M = mulM(pM, Rzyx(...part.pose.r)), p = path + '/' + part.name;
  for (const b of part.boxes) out.push({ uv: b.uv, box: b.box, grow: b.grow, pos: t, M, mirror: !!b.mirror, path: p });
  for (const c of part.children) flatten(c, t, M, out, p);
  return out;
}
function modelBoxes(vm, cls, method, desc, args) {
  const r = vm.call(cls, method, args || [], desc); const root = r.k === 'mesh' ? r.root : r.mesh.root; return flatten(root);
}
// Potion colours straight from the jar: MobEffects.<clinit> (name -> colour, field -> name) and Potions.<clinit> (potion -> effects).
function potionColors(vm) {
  const scan = (cn) => { const c = vm.cls(cn), m = c.methods.find(m => m.name === '<clinit>'); return decode(c, m.code).map(x => x.op); };
  const eff = scan('net/minecraft/world/effect/MobEffects'), color = {}, field2name = {}; let name = null;
  for (const [op, a] of eff) {
    if (op === 'const' && typeof a === 'string' && /^[a-z_]+$/.test(a) && !a.startsWith('effect')) name = a;
    else if (op === 'const' && Number.isInteger(a) && a >= 65536 && name && color[name] === undefined) color[name] = a;
    else if (op === 'putstatic' && name) { field2name[a.name] = name; }
  }
  const pot = scan('net/minecraft/world/item/alchemy/Potions'), out = {}; let cur = null, name2 = null, pending = [];
  for (let i = 0; i < pot.length; i++) {
    const [op, a] = pot[i];
    if (op === 'const' && typeof a === 'string' && /^[a-z_]+$/.test(a) && !name2) name2 = a;
    else if (op === 'getstatic' && /MobEffects$/.test(a.cls)) {
      const amp = pot[i + 2] && pot[i + 2][0] === 'const' ? pot[i + 2][1] : 0; pending.push({ eff: field2name[a.name], amp });
    } else if (op === 'invoke' && a.name === 'register') { if (name2 && !(name2 in out)) out[name2] = pending; name2 = null; pending = []; }
  }
  const mix = (list) => { if (!list.length) return 0x385DC6; let r = 0, g = 0, b = 0, t = 0;
    for (const e of list) { const c = color[e.eff], w = e.amp + 1; r += w * ((c >> 16) & 255); g += w * ((c >> 8) & 255); b += w * (c & 255); t += w; }
    return ((Math.round(r / t) << 16) | (Math.round(g / t) << 8) | Math.round(b / t)) >>> 0; };
  const res = {}; for (const k in out) res[k] = mix(out[k]); return { effectColors: color, potionColors: res, effects: out };
}
// Dye colours (banner tint) from DyeColor.<clinit>: first large int after each colour name.
function dyeColors(vm) {
  const c = vm.cls('net/minecraft/world/item/DyeColor'), m = c.methods.find(m => m.name === '<clinit>');
  const ops = decode(c, m.code).map(x => x.op), names = ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
  const out = {}; let cur = null;
  for (const [op, a] of ops) {
    if (op === 'const' && typeof a === 'string' && names.includes(a) && !(a in out) && cur === null) cur = a;
    else if (op === 'const' && Number.isInteger(a) && a >= 65536 && cur) { out[cur] = [(a >> 16) & 255, (a >> 8) & 255, a & 255]; cur = null; }
  }
  return out;
}
module.exports = { dyeColors, potionColors, parseClass, Vm, modelBoxes, flatten };
