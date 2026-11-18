// Share codes: compress a progress state into one pasteable line and read it back safely.
// No DOM access, so it also runs in Node for testing.
(function (root) {
  'use strict';

  const PREFIX = 'MCTL2';
  const MAX_DECODED = 30 * 1024 * 1024;
  const LIM = { nodes: 5000, rows: 30, entries: 200000 };
  const NODE_ID = /^[A-Za-z0-9_\-]{1,40}$/;
  const ITEM_ID = /^[A-Za-z0-9_.\-]{1,100}$/;
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const fail = (m) => { throw new Error(m); };

  function fnv(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64(str) {
    if (!/^[A-Za-z0-9_\-]*$/.test(str)) throw new Error('bad characters');
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deflate(bytes) {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }

  async function inflate(bytes, max) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes).catch(() => {});
    w.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) { reader.cancel().catch(() => {}); throw new Error('too large'); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  const str = (v, max, fallback) => {
    const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
    return s || fallback;
  };

  // Rebuilds a clean state from untrusted input. Anything malformed is dropped or repaired,
  // never trusted: ids, colours and text are validated, and every item appears at most once.
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || !raw.nodes || typeof raw.nodes !== 'object' || !Array.isArray(raw.order)) fail('This code does not contain a tier list.');
    if (raw.order.length > LIM.nodes) fail('That tier list is too large to load.');
    const nodes = {}, order = [], seenItems = new Set();
    let total = 0, rowCounter = 0;
    const keep = (arr) => (Array.isArray(arr) ? arr : []).filter((k) => {
      if (typeof k !== 'string' || !k.startsWith('i:') || !ITEM_ID.test(k.slice(2)) || seenItems.has(k)) return false;
      seenItems.add(k);
      total++;
      return true;
    });
    for (const id of raw.order) {
      const n = typeof id === 'string' && NODE_ID.test(id) && !nodes[id] ? raw.nodes[id] : null;
      if (!n || typeof n !== 'object') continue;
      const usedRows = new Set();
      let rows = (Array.isArray(n.rows) ? n.rows : []).slice(0, LIM.rows).map((r) => {
        r = r && typeof r === 'object' ? r : {};
        let rid = typeof r.id === 'string' && NODE_ID.test(r.id) && !usedRows.has(r.id) ? r.id : 'r' + id.slice(0, 8) + (rowCounter++).toString(36);
        while (usedRows.has(rid)) rid += 'x';
        usedRows.add(rid);
        return { id: rid, label: str(r.label, 14, '?'), color: HEX.test(r.color) ? r.color : '#888888', entries: keep(r.entries) };
      });
      if (!rows.length) rows = [{ id: 'r' + id.slice(0, 8) + (rowCounter++).toString(36), label: 'A', color: '#888888', entries: [] }];
      const tray = keep(n.tray);
      if (total > LIM.entries) fail('That tier list is too large to load.');
      nodes[id] = { id, title: str(n.title, 60, 'Untitled'), color: HEX.test(n.color) ? n.color : '#5b8def', done: n.done === true, icon: typeof n.icon === 'string' && ITEM_ID.test(n.icon) ? n.icon : '', rows, tray };
      order.push(id);
    }
    const shown = (Array.isArray(raw.shown) ? raw.shown : []).filter((id) => nodes[id]);
    return { v: 3, order, nodes, shown, showAll: raw.showAll === true };
  }

  function summarize(state) {
    let items = 0;
    const missingFrom = (libMap) => {
      let n = 0;
      for (const node of Object.values(state.nodes)) {
        const keys = [];
        node.rows.forEach((r) => keys.push(...r.entries));
        keys.push(...node.tray);
        for (const k of keys) if (!libMap.has(k.slice(2))) n++;
      }
      return n;
    };
    for (const node of Object.values(state.nodes)) {
      node.rows.forEach((r) => { items += r.entries.length; });
      items += node.tray.length;
    }
    return { items, categories: state.order.length, missingFrom };
  }

  async function encode(state, meta) {
    const payload = {
      app: 'mc-tierlist',
      v: 2,
      lib: { version: String((meta && meta.version) || ''), count: Number((meta && meta.count) || 0) },
      state: { v: 3, order: state.order, nodes: state.nodes, shown: state.shown, showAll: !!state.showAll },
    };
    const bytes = await deflate(new TextEncoder().encode(JSON.stringify(payload)));
    return PREFIX + '.' + toB64(bytes) + '.' + fnv(bytes);
  }

  async function decode(text) {
    const t = String(text || '').replace(/[\s"'`]+/g, '');
    const parts = t.split('.');
    if (parts.length === 3 && /^MCTL\d+$/.test(parts[0]) && parts[0] !== PREFIX) {
      fail(Number(parts[0].slice(4)) > 2 ? 'That code was made by a newer version of this app. Update the app and try again.' : 'That code is from an older version of this app (nested lists) and can no longer be loaded.');
    }
    if (parts[0] === PREFIX && parts.length !== 3) fail('The code is incomplete (the end is missing). Copy it again in full.');
    if (parts.length !== 3 || parts[0] !== PREFIX) fail('That does not look like a tier list code. Codes start with ' + PREFIX + '.');
    let bytes;
    try { bytes = fromB64(parts[1]); } catch (e) { fail('The code is damaged (unexpected characters). Copy it again in full.'); }
    if (fnv(bytes) !== parts[2].toLowerCase()) fail('The code is incomplete or changed while copying. Copy it again in full.');
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(await inflate(bytes, MAX_DECODED)));
    } catch (e) {
      fail('The code could not be read. Copy it again in full.');
    }
    if (!payload || payload.app !== 'mc-tierlist') fail('That code is not from this app.');
    const state = sanitize(payload.state);
    const lib = payload.lib && typeof payload.lib === 'object' ? payload.lib : {};
    return {
      state,
      lib: { version: str(lib.version, 40, ''), count: Number.isFinite(lib.count) ? lib.count : 0 },
      summary: summarize(state),
    };
  }

  const Share = { PREFIX, encode, decode, sanitize, summarize };
  root.Share = Share;
  if (typeof module !== 'undefined' && module.exports) module.exports = Share;
})(typeof window !== 'undefined' ? window : globalThis);
