'use strict';
// Icon renderer: turns item definitions + models + textures from the player's own Minecraft jar into
// inventory-style icons (flat sprites stay native; blocks and code-drawn items are rendered 3D at 64x64
// using the game's own GUI transform and lighting). Nothing from the jar is bundled with the app.
const png = require('./png');
const { Vm, modelBoxes, dyeColors, potionColors } = require('./classvm');

// ---------- tiny linear algebra (3x3 row-major arrays) ----------
const mul = (A, B) => { const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return r; };
const mulv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const rad = (d) => d * Math.PI / 180;
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const quatMat = ([x, y, z, w]) => { const n = Math.hypot(x, y, z, w) || 1; x /= n; y /= n; z /= n; w /= n;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]; };

// GUI display rotation. Verified against in-game screenshots: yaw runs opposite to the file's sign,
// except the stair (135), bed (340) and fence-gate (45) models which were calibrated individually.
const YAW = { 225: 135, 135: 45, 340: 340, 45: 315 };
// The 225/135/45 degree views are drawn with the camera turned a quarter-turn (see YAW), which also flips which way a
// sideways display translation moves an off-centre model (shelves). Beds (340) are unaffected.
function txSign(ry) { const key = ((Math.round(ry) % 360) + 360) % 360; return key in YAW && YAW[key] !== key ? -1 : 1; }
function guiRot(rx, ry, rz) {
  const key = ((Math.round(ry) % 360) + 360) % 360;
  const yaw = key in YAW ? YAW[key] : -ry;
  return mul(mul(Rx(rad(rx)), Ry(rad(yaw))), Rz(-rad(rz)));
}
// Light directions exactly as the game's Lighting class (ITEMS_FLAT for 'front', ITEMS_3D for 'side').
function gameLights(gl) {
  const D0 = norm([0.2, 1, -0.7]), D1 = norm([-0.2, 1, 0.7]), F = [1, 0, 0, 0, -1, 0, 0, 0, 1];
  const M = gl === 'side' ? mul(F, mul(Ry(1.0821041), mul(Rx(3.2375858), mul(Ry(-0.3926991), Rx(2.3561945))))) : mul(Ry(-0.3926991), Rx(2.3561945));
  return [mulv(F, mulv(M, D0)), mulv(F, mulv(M, D1))];
}

// ---------- raster canvas ----------
class Canvas {
  constructor(n) { this.n = n; this.img = new Uint8Array(n * n * 4); this.z = new Float32Array(n * n).fill(-1e9); }
}
// P: four view-space verts; P0->P3 is the texture's "s" direction, P0->P1 the "t" direction. UV: texel coords.
function raster(cv, P, UV, tex, shade, tint, ppu) {
  const n = cv.n, h = n / 2;
  const S = (q) => [h + q[0] * ppu, h - q[1] * ppu];
  const s0 = S(P[0]), s3 = S(P[3]), s1 = S(P[1]);
  const a0 = s3[0] - s0[0], a1 = s3[1] - s0[1], b0 = s1[0] - s0[0], b1 = s1[1] - s0[1];
  const det = a0 * b1 - a1 * b0; if (Math.abs(det) < 1e-9) return;
  const xs = [s0[0], s0[0] + a0, s0[0] + b0, s0[0] + a0 + b0], ys = [s0[1], s0[1] + a1, s0[1] + b1, s0[1] + a1 + b1];
  const x0 = Math.max(0, Math.trunc(Math.min(...xs))), x1 = Math.min(n, Math.trunc(Math.max(...xs)) + 1);
  const y0 = Math.max(0, Math.trunc(Math.min(...ys))), y1 = Math.min(n, Math.trunc(Math.max(...ys)) + 1);
  const dz3 = P[3][2] - P[0][2], dz1 = P[1][2] - P[0][2], uv0 = UV[0], uv1 = UV[1], uv3 = UV[3];
  const du3 = uv3[0] - uv0[0], dv3 = uv3[1] - uv0[1], du1 = uv1[0] - uv0[0], dv1 = uv1[1] - uv0[1];
  const tw = tex.w, th = tex.h, td = tex.data, img = cv.img, zb = cv.z;
  for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
    const px = gx + 0.5 - s0[0], py = gy + 0.5 - s0[1];
    const s = (px * b1 - py * b0) / det, t = (a0 * py - a1 * px) / det;
    if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;
    const zz = P[0][2] + s * dz3 + t * dz1, idx = gy * n + gx;
    if (zz < zb[idx] - 1e-4) continue;
    let tu = Math.trunc(uv0[0] + s * du3 + t * du1), tv = Math.trunc(uv0[1] + s * dv3 + t * dv1);
    tu = tu < 0 ? 0 : tu >= tw ? tw - 1 : tu; tv = tv < 0 ? 0 : tv >= th ? th - 1 : tv;
    const o = (tv * tw + tu) * 4; if (td[o + 3] === 0) continue;
    const q = idx * 4, k = shade;
    let r = td[o] * k * tint[0], g = td[o + 1] * k * tint[1], b = td[o + 2] * k * tint[2];
    img[q] = r > 255 ? 255 : r; img[q + 1] = g > 255 ? 255 : g; img[q + 2] = b > 255 ? 255 : b; img[q + 3] = td[o + 3]; zb[idx] = zz;
  }
}

// premultiplied integer box downsample (like Pillow's BOX on RGBA)
function downsample(img, n, f) {
  const m = n / f, out = new Uint8Array(m * m * 4), cnt = f * f;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    let a = 0, r = 0, g = 0, b = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) { const o = ((y * f + j) * n + x * f + i) * 4, al = img[o + 3]; a += al; r += img[o] * al; g += img[o + 1] * al; b += img[o + 2] * al; }
    const q = (y * m + x) * 4; if (a > 0) { out[q] = Math.round(r / a); out[q + 1] = Math.round(g / a); out[q + 2] = Math.round(b / a); out[q + 3] = Math.round(a / cnt); }
  }
  return { w: m, h: m, data: out };
}
function bbox(im) {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
function crop(im, [x0, y0, x1, y1]) {
  const w = x1 - x0, h = y1 - y0, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y + y0) * im.w + x + x0) * 4, o = (y * w + x) * 4; d[o] = im.data[s]; d[o + 1] = im.data[s + 1]; d[o + 2] = im.data[s + 2]; d[o + 3] = im.data[s + 3]; }
  return { w, h, data: d };
}
// area-weighted (box) resize, premultiplied, separable
function resizeBox(im, nw, nh) {
  const pass = (src, sw, sh, dw, dh, horiz) => {
    const out = new Float64Array(dw * dh * 4), ratio = (horiz ? sw : sh) / (horiz ? dw : dh);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const lo = (horiz ? x : y) * ratio, hi = lo + ratio; let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let k = Math.floor(lo); k < Math.ceil(hi - 1e-9); k++) {
        const wgt = Math.min(hi, k + 1) - Math.max(lo, k); const o = horiz ? (y * sw + k) * 4 : (k * sw + x) * 4;
        r += src[o] * wgt; g += src[o + 1] * wgt; b += src[o + 2] * wgt; a += src[o + 3] * wgt; wsum += wgt;
      }
      const q = (y * dw + x) * 4; out[q] = r / wsum; out[q + 1] = g / wsum; out[q + 2] = b / wsum; out[q + 3] = a / wsum;
    }
    return out;
  };
  const pm = new Float64Array(im.w * im.h * 4);
  for (let i = 0; i < im.w * im.h; i++) { const a = im.data[i * 4 + 3] / 255; pm[i * 4] = im.data[i * 4] * a; pm[i * 4 + 1] = im.data[i * 4 + 1] * a; pm[i * 4 + 2] = im.data[i * 4 + 2] * a; pm[i * 4 + 3] = im.data[i * 4 + 3]; }
  const t1 = pass(pm, im.w, im.h, nw, im.h, true), t2 = pass(t1, nw, im.h, nw, nh, false), d = new Uint8Array(nw * nh * 4);
  for (let i = 0; i < nw * nh; i++) { const a = t2[i * 4 + 3]; if (a > 0) { const k = 255 / a; d[i * 4] = Math.min(255, Math.round(t2[i * 4] * k)); d[i * 4 + 1] = Math.min(255, Math.round(t2[i * 4 + 1] * k)); d[i * 4 + 2] = Math.min(255, Math.round(t2[i * 4 + 2] * k)); d[i * 4 + 3] = Math.round(a); } }
  return { w: nw, h: nh, data: d };
}
function over(dst, src) { // alpha composite src over dst (same size, non-premultiplied)
  for (let i = 0; i < dst.w * dst.h; i++) {
    const o = i * 4, sa = src.data[o + 3] / 255, da = dst.data[o + 3] / 255, oa = sa + da * (1 - sa); if (oa <= 0) continue;
    for (let c = 0; c < 3; c++) dst.data[o + c] = Math.round((src.data[o + c] * sa + dst.data[o + c] * da * (1 - sa)) / oa);
    dst.data[o + 3] = Math.round(oa * 255);
  }
}

// ---------- assets ----------
const mid = (s) => String(s).replace(/^minecraft:/, '').replace(/^[^:]+:/, '');
class Assets {
  constructor(jar) { this.jar = jar; this.models = new Map(); this.textures = new Map(); this.jsons = new Map(); this.classIndex = null; }
  json(path) { if (!this.jsons.has(path)) this.jsons.set(path, this.jar.json(path)); return this.jsons.get(path); }
  model(name) {
    name = mid(name);
    if (!this.models.has(name)) this.models.set(name, name.startsWith('builtin/') ? {} : this.json('assets/minecraft/models/' + name + '.json'));
    return this.models.get(name);
  }
  texture(ref, prefix) { // 'block/stone' -> decoded RGBA, first animation frame
    const path = 'assets/minecraft/' + (prefix || 'textures/') + mid(ref) + '.png';
    if (!this.textures.has(path)) {
      const d = png.decode(this.jar.read(path)); let t = d;
      if (d.h > d.w && d.h % d.w === 0) t = { w: d.w, h: d.w, data: d.data.subarray(0, d.w * d.w * 4) };
      this.textures.set(path, t);
    }
    return this.textures.get(path);
  }
  rawTexture(path) { // full path inside the jar, no animation crop
    if (!this.textures.has(path)) this.textures.set(path, png.decode(this.jar.read(path)));
    return this.textures.get(path);
  }
  hasTexture(path) { return this.jar.has(path); }
}

function resolveModel(A, name) {
  const chain = []; let n = name, guard = 0;
  while (n && guard++ < 32) { const m = A.model(n); chain.push([mid(n), m]); n = m.parent; }
  const textures = {}, display = {}; let elements = null, gl = null;
  for (const [, m] of chain.slice().reverse()) {
    Object.assign(textures, m.textures || {});
    for (const [k, v] of Object.entries(m.display || {})) display[k] = Object.assign(display[k] || {}, v);
    if (m.elements) elements = m.elements; if (m.gui_light) gl = m.gui_light;
  }
  return { textures, display, elements: elements || [], guiLight: gl, root: chain[chain.length - 1][0], chain: chain.map((c) => c[0]) };
}
function texRef(textures, ref) {
  let guard = 0; if (ref && typeof ref === 'object') ref = ref.sprite;
  // tolerate a bare variable name (e.g. heavy_core faces say "all" instead of "#all")
  if (typeof ref === 'string' && !ref.includes('/') && !ref.includes(':') && !ref.startsWith('#') && textures && textures[ref] != null) ref = '#' + ref;
  while (typeof ref === 'string' && ref.startsWith('#') && guard++ < 20) { ref = textures[ref.slice(1)]; if (ref && typeof ref === 'object') ref = ref.sprite; }
  return typeof ref === 'string' && !ref.startsWith('#') ? ref : null;
}
const isFlat = (R) => R.root === 'builtin/generated' || R.chain.includes('builtin/generated');

// ---------- block model faces ----------
function faceVerts(f, a, b) {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  return { down: [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], up: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    north: [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]], south: [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]],
    west: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], east: [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]] }[f];
}
function defaultUv(f, a, b) {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  return { up: [x0, z0, x1, z1], down: [x0, 16 - z1, x1, 16 - z0], north: [16 - x1, 16 - y1, 16 - x0, 16 - y0], south: [x0, 16 - y1, x1, 16 - y0], west: [z0, 16 - y1, z1, 16 - y0], east: [16 - z1, 16 - y1, 16 - z0, 16 - y0] }[f];
}
const NORM = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const ENT_NORM = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, -1, 0], down: [0, 1, 0] }; // entity models are y-down

function tintColor(A, tints, idx, override) {
  if (override && idx === 0) return override.map((v) => v / 255);
  if (!tints || idx >= tints.length) return [1, 1, 1];
  const t = tints[idx], ty = mid(t.type || '');
  if (ty === 'constant') { const v = t.value & 0xffffff; return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x / 255); }
  if (ty === 'grass') {
    const cm = A.rawTexture('assets/minecraft/textures/colormap/grass.png'), te = Math.min(Math.max(t.temperature == null ? 0.5 : t.temperature, 0), 1);
    const dn = Math.min(Math.max(t.downfall == null ? 1 : t.downfall, 0), 1) * te, x = Math.trunc((1 - te) * 255), y = Math.trunc((1 - dn) * 255), o = (y * cm.w + x) * 4;
    return [cm.data[o] / 255, cm.data[o + 1] / 255, cm.data[o + 2] / 255];
  }
  if (t.default != null) { const v = t.default & 0xffffff; return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x / 255); }
  return [1, 1, 1];
}

function drawBlockModel(A, cv, R, tints, xf) {
  xf = xf || {};
  const xs = xf.scale || [1, 1, 1], xt = xf.translation || [0, 0, 0], xr = xf.left_rotation ? quatMat(xf.left_rotation) : null;
  const g = R.display.gui || {}, rot = g.rotation || [0, 0, 0], tr = g.translation || [0, 0, 0], sc = g.scale || [1, 1, 1];
  const Rm = guiRot(rot[0], rot[1], rot[2]), T = tr.map((v, i) => (i === 0 ? v * txSign(rot[1]) : v) / 16);
  let gl = R.guiLight || (isFlat(R) ? 'front' : 'side'); if (R.root === 'builtin/generated') gl = 'front';
  const [L0, L1] = gameLights(gl), ppu = cv.n;
  for (const el of R.elements) {
    const a = el.from, b = el.to, shadeOn = el.shade !== false;
    for (const [f, fd] of Object.entries(el.faces || {})) {
      const ref = texRef(R.textures, fd.texture); if (!ref) continue;
      const tex = A.texture(ref);
      let V = faceVerts(f, a, b).map((p) => p.slice()), nrm = NORM[f].slice();
      if (el.rotation) {
        const r = el.rotation, o = r.origin, Mr = { x: Rx, y: Ry, z: Rz }[r.axis](rad(r.angle));
        let sv = [1, 1, 1]; if (r.rescale) { const k = 1 / Math.cos(rad(Math.abs(r.angle))); sv = ['x', 'y', 'z'].map((ax) => (ax === r.axis ? 1 : k)); }
        V = V.map((p) => add(o, mulv(Mr, [(p[0] - o[0]) * sv[0], (p[1] - o[1]) * sv[1], (p[2] - o[2]) * sv[2]]))); nrm = mulv(Mr, nrm);
      }
      const W = V.map((p) => {
        let q = [p[0] / 16 * xs[0], p[1] / 16 * xs[1], p[2] / 16 * xs[2]]; if (xr) q = mulv(xr, q); q = add(q, xt);
        return add(mulv(Rm, [(q[0] - 0.5) * sc[0], (q[1] - 0.5) * sc[1], (q[2] - 0.5) * sc[2]]), T);
      });
      const n = norm(mulv(Rm, nrm)); if (n[2] <= 1e-6) continue;
      const shade = shadeOn ? Math.min(1, 0.4 + 0.6 * (Math.max(0, dot(n, L0)) + Math.max(0, dot(n, L1)))) : 1;
      const [u0, v0, u1, v1] = fd.uv || defaultUv(f, a, b); let corners = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
      const k = (((fd.rotation || 0) / 90) % 4 + 4) % 4; corners = corners.map((_, i) => corners[(i + k) % 4]);
      const uvs = corners.map(([u, v]) => [u * tex.w / 16, v * tex.h / 16]);
      raster(cv, W, uvs, tex, shade, fd.tintindex != null ? tintColor(A, tints, fd.tintindex) : [1, 1, 1], ppu);
    }
  }
}

function drawFlat(A, R, tints, override) {
  const layers = []; for (let i = 0; R.textures['layer' + i] != null; i++) layers.push(A.texture(texRef(R.textures, R.textures['layer' + i])));
  if (!layers.length) return null;
  const W = Math.max(...layers.map((l) => l.w)); let out = { w: W, h: W, data: new Uint8Array(W * W * 4) };
  layers.forEach((l, i) => {
    let src = l; if (l.w !== W) { const d = new Uint8Array(W * W * 4); for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const s = ((Math.floor(y * l.h / W)) * l.w + Math.floor(x * l.w / W)) * 4, o = (y * W + x) * 4; d[o] = l.data[s]; d[o + 1] = l.data[s + 1]; d[o + 2] = l.data[s + 2]; d[o + 3] = l.data[s + 3]; } src = { w: W, h: W, data: d }; }
    const tc = tintColor(A, tints, i, override), d = new Uint8Array(src.data);
    for (let p = 0; p < W * W; p++) for (let c = 0; c < 3; c++) d[p * 4 + c] = Math.min(255, Math.round(d[p * 4 + c] * tc[c]));
    over(out, { w: W, h: W, data: d });
  });
  return out;
}

// ---------- item definition resolution ----------
// Collapses select / condition / range_dispatch / composite to what the game shows by default in the GUI.
function pick(node, inherited) {
  const t = mid(node.type || ''), xf = node.transformation || inherited;
  if (t === 'model') return [{ model: node.model, tints: node.tints, xf: node.transformation || inherited }];
  if (t === 'special') return [{ special: node.model, base: node.base, xf, tints: node.tints }];
  if (t === 'composite') return node.models.flatMap((m) => pick(m, xf));
  if (t === 'select' && mid(node.property || '') === 'display_context') {
    for (const c of node.cases || []) { const w = Array.isArray(c.when) ? c.when : [c.when]; if (w.includes('gui')) return pick(c.model, xf); }
  }
  if (node.fallback) return pick(node.fallback, xf);
  if (t === 'condition' && node.on_false) return pick(node.on_false, xf);
  const list = node.cases || node.entries; if (list && list.length) return pick(list[0].model, xf);
  if (node.model && typeof node.model === 'object') return pick(node.model, xf);
  throw new Error('Unrecognised item definition type: ' + t);
}

// ---------- entity (code-drawn) models ----------
function boxFaces(u, v, x, y, z, w, h, d, g, mirror) {
  const x0 = x - g, y0 = y - g, z0 = z - g, x1 = x + w + g, y1 = y + h + g, z1 = z + d + g, W = w + 2 * g, H = h + 2 * g, D = d + 2 * g;
  const faces = {
    north: [[x0, y0, z0], [W, 0, 0], [0, H, 0], [u + d, v + d, u + d + w, v + d + h]],
    south: [[x1, y0, z1], [-W, 0, 0], [0, H, 0], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]],
    west: [[x0, y0, z1], [0, 0, -D], [0, H, 0], [u, v + d, u + d, v + d + h]],
    east: [[x1, y0, z0], [0, 0, D], [0, H, 0], [u + d + w, v + d, u + 2 * d + w, v + d + h]],
    up: [[x0, y0, z1], [W, 0, 0], [0, 0, -D], [u + d, v, u + d + w, v + d]],
    down: [[x0, y1, z1], [W, 0, 0], [0, 0, -D], [u + d + w, v, u + 2 * d + w, v + d]],
  };
  if (mirror) {
    for (const k of Object.keys(faces)) { const f = faces[k][3]; faces[k][3] = [f[2], f[1], f[0], f[3]]; }
    const w2 = faces.west[3], e2 = faces.east[3]; faces.west[3] = e2; faces.east[3] = w2;
  }
  return faces;
}
// parts: [{uv, box, pos, M, grow, mirror, tint, tex, rotx}] in model pixels; toWorld(vec)->world; lin: linear part of toWorld
function drawParts(cv, parts, defTex, rot, scale, trans, toWorld, lin, gl) {
  const Rm = guiRot(rot[0], rot[1], rot[2]), T = trans.map((v) => v / 16), [L0, L1] = gameLights(gl || 'front'), ppu = 256;
  for (const part of parts) {
    const tex = part.tex || defTex, [u, v] = part.uv, [x, y, z, w, h, d] = part.box, g = part.grow || 0;
    const PM = part.M || I3, tint = (part.tint || [255, 255, 255]).map((c) => c / 255);
    for (const [name, [o, eu, ev, [ua, va, ub, vb]]] of Object.entries(boxFaces(u, v, x, y, z, w, h, d, g, part.mirror))) {
      const Vp = (p) => add(mulv(Rm, mulv([scale, 0, 0, 0, scale, 0, 0, 0, scale], sub(toWorld(add(part.pos, mulv(PM, p))), [0.5, 0.5, 0.5]))), T);
      const P0 = Vp(o), P1 = Vp(add(o, ev)), P3 = Vp(add(o, eu)), P2 = Vp(add(add(o, eu), ev));
      const n = norm(mulv(Rm, mulv(lin, mulv(PM, ENT_NORM[name])))); if (n[2] <= 1e-6) continue;
      const shade = Math.min(1, 0.4 + 0.6 * (Math.max(0, dot(n, L0)) + Math.max(0, dot(n, L1))));
      raster(cv, [P0, P1, P2, P3], [[ua, va], [ua, vb], [ub, vb], [ub, va]], tex, shade, tint, ppu);
    }
  }
}

class Specials {
  constructor(A) {
    this.A = A; this.vm = new Vm((n) => this.loadClass(n)); this.cache = new Map(); this._dye = null;
  }
  index() {
    if (!this.idx) { this.idx = new Map(); for (const k of this.A.jar.list('')) if (k.endsWith('.class')) { const s = k.slice(0, -6); this.idx.set(s.split('/').pop(), s); } }
    return this.idx;
  }
  loadClass(name) {
    if (this.A.jar.has(name + '.class')) return this.A.jar.read(name + '.class');
    const alt = this.index().get(name.split('/').pop()); // class moved to another package in a newer version
    if (alt) return this.A.jar.read(alt + '.class');
    throw new Error('Class not found in this version: ' + name);
  }
  boxes(key, cls, method, args) {
    if (!this.cache.has(key)) this.cache.set(key, modelBoxes(this.vm, cls, method, undefined, args));
    return this.cache.get(key).map((b) => Object.assign({}, b));
  }
  dye() { if (!this._dye) this._dye = dyeColors(this.vm); return this._dye; }
}

const TRANS_ID = { left_rotation: [0, 0, 0, 1], right_rotation: [0, 0, 0, 1], scale: [1, 1, 1], translation: [0, 0, 0] };
function worldFn(xf, pre) { // Mojang Transformation: p' = T + L * (S * (Rr * p)); `pre` = model-space matrix applied first
  const t = Object.assign({}, TRANS_ID, xf || {}), L = quatMat(t.left_rotation), Rr = quatMat(t.right_rotation), s = t.scale;
  const lin = mul(mul(L, [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]]), Rr);
  const full = pre ? mul(lin, pre) : lin;
  return { fn: (p) => add(mulv(full, [p[0] / 16, p[1] / 16, p[2] / 16]), t.translation), lin: full };
}

const H = 768, SLOT = [256, 256, 512, 512];
function fitSpecial(cv) {
  const im = { w: H, h: H, data: cv.img }, bb = bbox(im); if (!bb) return null;
  let slot;
  if (bb[0] >= SLOT[0] && bb[1] >= SLOT[1] && bb[2] <= SLOT[2] && bb[3] <= SLOT[3]) slot = crop(im, SLOT);
  else { // overflowing icons shrink to fit; the rest keep the game's exact placement
    let c = crop(im, bb); const k = Math.min(240 / c.w, 240 / c.h); c = resizeBox(c, Math.max(1, Math.trunc(c.w * k)), Math.max(1, Math.trunc(c.h * k)));
    slot = { w: 256, h: 256, data: new Uint8Array(256 * 256 * 4) }; const ox = Math.floor((256 - c.w) / 2), oy = Math.floor((256 - c.h) / 2);
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const s = (y * c.w + x) * 4, o = ((y + oy) * 256 + x + ox) * 4; slot.data.set(c.data.subarray(s, s + 4), o); }
  }
  return downsample(slot.data, 256, 4);
}

const HEAD_TEX = { creeper: 'creeper/creeper', zombie: 'zombie/zombie', skeleton: 'skeleton/skeleton', wither_skeleton: 'skeleton/wither_skeleton', piglin: 'piglin/piglin', dragon: 'enderdragon/dragon' };
function renderSpecial(A, S, spec, base, xf) {
  const type = mid(spec.type), E = 'assets/minecraft/textures/entity/', cv = new Canvas(H);
  const baseModel = base ? resolveModel(A, base) : null, g = (baseModel && baseModel.display.gui) || {};
  let rot = g.rotation || [30, 45, 0], scale = (g.scale || [1, 1, 1])[0], trans = g.translation || [0, 0, 0], gl = (baseModel && baseModel.guiLight) || 'front';
  const tex = (p) => A.rawTexture(E + p + '.png'), draw = (parts, defTex, wf) => drawParts(cv, parts, defTex, rot, scale, trans, wf.fn, wf.lin, gl);
  const boxesOf = (key, cls, m, a) => S.boxes(key, cls, m, a);
  const NS = 'net/minecraft/client/';
  if (type === 'shulker_box') {
    const parts = boxesOf('shulker', NS + 'model/monster/shulker/ShulkerModel', 'createBoxLayer', []).reverse(); // base first, lid wins ties
    draw(parts, tex('shulker/' + mid(spec.texture)), worldFn(xf));
  } else if (type === 'banner') {
    const body = boxesOf('banner', NS + 'model/object/banner/BannerModel', 'createBodyLayer', [1]);
    const flag = boxesOf('bannerflag', NS + 'model/object/banner/BannerFlagModel', 'createFlagLayer', [1]);
    const fr = (-0.0125 + 0.01 * Math.cos(0)) * Math.PI; // BannerFlagModel.setupAnim at phase 0
    const col = S.dye()[spec.color] || [255, 255, 255];
    const bars = body.filter((b) => /\/bar$/.test(b.path)), topBar = bars.length ? bars.reduce((a, b) => (b.box[1] < a.box[1] ? b : a)) : null; // the standing bar, not the wall-mount one
    const parts = body.filter((b) => !/\/bar$/.test(b.path) || b === topBar).concat(flag.map((b) => Object.assign(b, { M: Rx(fr), tint: col })));
    draw(parts, tex('banner/banner_base'), worldFn(xf));
  } else if (type === 'chest') {
    draw(boxesOf('chest', NS + 'model/object/chest/ChestModel', 'createSingleBodyLayer', []), tex('chest/' + mid(spec.texture)), worldFn(xf));
  } else if (type === 'copper_golem_statue') {
    const pose = { standing: 'createBodyLayer', sitting: 'createSittingPoseBodyLayer', running: 'createRunningPoseBodyLayer', star: 'createStarPoseBodyLayer' }[spec.pose] || 'createBodyLayer';
    const parts = boxesOf('golem_' + pose, NS + 'model/animal/golem/CopperGolemModel', pose, []);
    const flip = [-1, 0, 0, 0, -1, 0, 0, 0, 1]; // CopperGolemStatueModel.setupAnim: root zRot = pi
    const p2 = parts.map((b) => Object.assign(b, { pos: mulv(flip, b.pos), M: mul(flip, b.M) }));
    const path = String(spec.texture).replace(/^[^:]*:/, ''); draw(p2, A.rawTexture('assets/minecraft/' + path), worldFn(xf));
  } else if (type === 'conduit') {
    draw(boxesOf('conduit', NS + 'renderer/blockentity/ConduitRenderer', 'createShellLayer', []), tex('conduit/base'), worldFn(xf));
  } else if (type === 'decorated_pot') {
    const b = tex('decorated_pot/decorated_pot_base'), s = tex('decorated_pot/decorated_pot_side');
    const R = NS + 'renderer/blockentity/DecoratedPotRenderer';
    const parts = boxesOf('pot_base', R, 'createBaseLayer', []).map((p) => Object.assign(p, { tex: b })).concat(boxesOf('pot_side', R, 'createSidesLayer', []).map((p) => Object.assign(p, { tex: s })));
    draw(parts, b, worldFn(xf));
  } else if (type === 'shield') {
    rot = [30, 45, 0]; scale = 0.65; trans = [0, 0, 0]; // matches the in-game inventory look the user verified
    const parts = boxesOf('shield', NS + 'model/object/equipment/ShieldModel', 'createLayer', []);
    draw(parts, tex('shield/shield_base_nopattern'), worldFn(Object.assign({}, xf, { translation: [0.5, 0.5, 0.5] })));
  } else if (type === 'head' || type === 'player_head') {
    const kind = type === 'player_head' ? 'player' : spec.kind, K = NS + 'model/object/skull/';
    let parts, t;
    if (kind === 'piglin') { parts = boxesOf('piglin', K + 'PiglinHeadModel', 'createHeadModel', []); t = tex(HEAD_TEX.piglin); }
    else if (kind === 'dragon') { parts = boxesOf('dragon', K + 'DragonHeadModel', 'createHeadLayer', []); t = tex(HEAD_TEX.dragon); }
    else if (kind === 'zombie' || kind === 'player') { parts = boxesOf('skull_h', K + 'SkullModel', 'createHumanoidHeadLayer', []); t = kind === 'player' ? tex('player/wide/steve') : tex(HEAD_TEX.zombie); }
    else { parts = boxesOf('skull_m', K + 'SkullModel', 'createMobHeadLayer', []); t = tex(HEAD_TEX[kind]); }
    draw(parts, t, worldFn(xf));
  } else throw new Error('Unsupported special model: ' + type);
  const out = fitSpecial(cv); if (!out) throw new Error('Rendered nothing');
  return out;
}

// ---------- the public renderer ----------
class IconRenderer {
  constructor(jar) { this.jar = jar; this.A = new Assets(jar); this.S = new Specials(this.A); }
  // -> { kind:'flat'|'3d', w, h, data }
  item(id) {
    const A = this.A, def = A.json('assets/minecraft/items/' + id + '.json'); if (!def.model) throw new Error('Item has no model');
    const parts = pick(def.model); const sp = parts.find((p) => p.special);
    if (sp) return Object.assign({ kind: '3d' }, renderSpecial(A, this.S, sp.special, sp.base, sp.xf));
    const resolved = parts.map((p) => ({ p, R: resolveModel(A, p.model) })), blocks = resolved.filter((r) => !isFlat(r.R));
    if (blocks.length) {
      const cv = new Canvas(256); for (const { p, R } of blocks) drawBlockModel(A, cv, R, p.tints, p.xf);
      const im = downsample(cv.img, 256, 4); if (!bbox(im)) throw new Error('Rendered nothing'); return Object.assign({ kind: '3d' }, im);
    }
    const first = resolved[0]; const im = drawFlat(A, first.R, first.p.tints); if (!im || !bbox(im)) throw new Error('Rendered nothing');
    return Object.assign({ kind: 'flat' }, im);
  }
  // flat item with an explicit colour on layer 0 (potions / tipped arrows)
  tinted(id, rgb) {
    const A = this.A, def = A.json('assets/minecraft/items/' + id + '.json'), p = pick(def.model)[0];
    return Object.assign({ kind: 'flat' }, drawFlat(A, resolveModel(A, p.model), p.tints, rgb));
  }
}

module.exports = { IconRenderer, Assets, resolveModel, pick, png, Canvas, potionColors, Vm };
