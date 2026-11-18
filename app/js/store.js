// Data layer: no DOM access, so it can be unit-tested in plain Node.
// A flat list of categories. Each category has its own tier rows and an unranked tray.
(function (root) {
  'use strict';

  const DEFAULT_ROWS = [
    { label: 'S', color: '#ff7f7f' },
    { label: 'A', color: '#ffbf7f' },
    { label: 'B', color: '#ffdf7f' },
    { label: 'C', color: '#bfff7f' },
    { label: 'D', color: '#7fffff' },
    { label: 'F', color: '#7f9fff' },
  ];
  const PALETTE = ['#e0645c', '#e0b84a', '#4fb3d9', '#7bc96f', '#b07be0', '#e08a4f', '#5fc9b0', '#d96fa6', '#8fa0b5', '#a3c94f'];

  let counter = 0;
  const uid = (p) => p + Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);
  const makeRows = () => DEFAULT_ROWS.map((r) => ({ id: uid('r'), label: r.label, color: r.color, entries: [] }));

  const wordsOf = (id) => String(id).split('_').filter((w) => w && !/^\d+$/.test(w));
  const lastWord = (id) => { const w = wordsOf(id); return w.length ? w[w.length - 1] : String(id); };
  const noisyTag = (tag, count) => count > 200 || count < 2 || tag.startsWith('#minecraft:enchantable/');
  const keyOf = (id) => 'i:' + id;

  class Store {
    constructor(library) {
      this.library = library || { rev: 1, version: '', items: [] };
      this.state = null;
      this.undoStack = [];
      this.redoStack = [];
      this.listeners = new Set();
      this.placed = new Map(); // itemId -> categoryId
      this.reindexLibrary();
    }

    // ---- plumbing -------------------------------------------------------
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(kind) { for (const fn of [...this.listeners]) { try { fn(kind); } catch (e) { console.error(e); } } }
    reindexLibrary() {
      this.itemMap = new Map(this.library.items.map((i) => [i.id, i]));
      this._tagCache = null;
    }
    setLibrary(lib) { this.library = lib; this.reindexLibrary(); if (this.state) this.index(); this.emit('library'); }
    clearHistory() { this.undoStack = []; this.redoStack = []; }
    freshState() { return { v: 3, order: [], nodes: {}, shown: [], showAll: false, merged: false }; }
    _normalize(s) {
      if (!s || s.v !== 3 || !s.nodes || !Array.isArray(s.order)) return this.freshState();
      s.order = s.order.filter((id) => s.nodes[id]);
      for (const id of Object.keys(s.nodes)) if (!s.order.includes(id)) delete s.nodes[id];
      for (const n of Object.values(s.nodes)) {
        n.rows = Array.isArray(n.rows) && n.rows.length ? n.rows : makeRows();
        for (const r of n.rows) { if (!r.id) r.id = uid('r'); r.entries = Array.isArray(r.entries) ? r.entries : []; }
        n.tray = Array.isArray(n.tray) ? n.tray : [];
        n.done = n.done === true;
        n.color = n.color || PALETTE[0];
        n.icon = typeof n.icon === 'string' ? n.icon : '';
      }
      s.shown = (Array.isArray(s.shown) ? s.shown : []).filter((id) => s.nodes[id]);
      s.showAll = s.showAll === true;
      s.merged = s.merged === true;
      s.todo = s.todo === true;
      s.pins = Array.isArray(s.pins) ? Array.from({ length: 9 }, (_, i) => (s.nodes[s.pins[i]] ? s.pins[i] : null)) : null;
      return s;
    }
    load(progress) { this.state = this._normalize(progress); this.clearHistory(); this.index(); this.emit('load'); }
    replaceState(next) {
      const snap = JSON.stringify(this.state);
      this.state = this._normalize(next);
      this.undoStack.push(snap); this.redoStack = [];
      this.index(); this.emit('change');
    }
    index() {
      this.placed = new Map();
      for (const n of Object.values(this.state.nodes)) for (const k of this.allKeys(n)) this.placed.set(k.slice(2), n.id);
    }
    mutate(fn) {
      const snap = JSON.stringify(this.state);
      const result = fn(this.state);
      if (result === false) return false;
      if (JSON.stringify(this.state) === snap) return false;
      this.undoStack.push(snap);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
      this.index(); this.emit('change');
      return result === undefined ? true : result;
    }
    undo() { if (!this.undoStack.length) return false; this.redoStack.push(JSON.stringify(this.state)); this._restore(this.undoStack.pop()); return true; }
    redo() { if (!this.redoStack.length) return false; this.undoStack.push(JSON.stringify(this.state)); this._restore(this.redoStack.pop()); return true; }
    _restore(json) { this.state = JSON.parse(json); this.index(); this.emit('change'); }

    // ---- queries --------------------------------------------------------
    item(id) { return this.itemMap.get(id) || null; }
    node(id) { return this.state.nodes[id] || null; }
    categories(opts) { // in tab order; { open: true } leaves out done ones
      const out = this.state.order.map((id) => this.state.nodes[id]);
      return opts && opts.open ? out.filter((n) => !n.done) : out;
    }
    visible() { // categories currently shown as columns
      const s = this.state;
      if (s.todo) return this.categories().filter((n) => n.tray.length);
      return s.showAll ? this.categories() : this.categories().filter((n) => s.shown.includes(n.id));
    }
    allKeys(n) { const out = []; for (const r of n.rows) out.push(...r.entries); out.push(...n.tray); return out; }
    itemIdsOf(n) { return this.allKeys(n).map((k) => k.slice(2)); }
    countItems(id) { const n = this.node(id); return n ? this.allKeys(n).length : 0; }
    isRated(id) { return this.placed.has(id); }
    homeOf(id) { return this.placed.get(id) || null; }
    isDone(id) { const n = this.node(id); return !!(n && n.done); }
    activeItems() { return this.library.items.filter((i) => !i.removedIn); }
    unratedItems(includeRemoved) { return this.library.items.filter((i) => (includeRemoved || !i.removedIn) && !this.isRated(i.id)); }
    ratedAmong(ids) { let n = 0; for (const id of new Set(ids)) if (this.isRated(id)) n++; return n; }
    tagCounts() {
      if (!this._tagCache) {
        const c = new Map();
        for (const i of this.library.items) for (const t of i.tags || []) c.set(t, (c.get(t) || 0) + 1);
        this._tagCache = c;
      }
      return this._tagCache;
    }
    // How well an item fits a category: shared (non-noisy) tags with its items, plus the same last word.
    fitScore(itemId, nodeId) {
      const n = this.node(nodeId), it = this.item(itemId);
      if (!n || !it) return 0;
      const counts = this.tagCounts(), mine = (it.tags || []).filter((t) => !noisyTag(t, counts.get(t) || 0));
      const lw = lastWord(itemId);
      let score = n.title.toLowerCase().includes(lw) ? 2 : 0;
      for (const other of this.itemIdsOf(n)) {
        if (other === itemId) continue;
        if (lastWord(other) === lw) score += 1;
        const o = this.item(other);
        if (o && mine.length) for (const t of o.tags || []) if (mine.includes(t)) score += 1 / Math.sqrt(counts.get(t) || 1);
      }
      return score;
    }
    suggestFor(itemId) {
      return this.categories({ open: true })
        .map((n) => ({ node: n, score: this.fitScore(itemId, n.id) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
    }
    newMatchesFor(nodeId) { return this.library.items.filter((i) => i.new && !i.removedIn && !this.isRated(i.id) && this.fitScore(i.id, nodeId) >= 1); }
    doneListsMatching(itemId) { return this.categories().filter((n) => n.done && this.fitScore(itemId, n.id) >= 1); }

    // ---- mutations ------------------------------------------------------
    _remove(n, key) {
      for (const r of n.rows) { const i = r.entries.indexOf(key); if (i >= 0) { r.entries.splice(i, 1); return true; } }
      const i = n.tray.indexOf(key);
      if (i >= 0) { n.tray.splice(i, 1); return true; }
      return false;
    }
    _insert(n, rowId, key, idx) {
      const row = rowId ? n.rows.find((r) => r.id === rowId) : null;
      const arr = row ? row.entries : n.tray;
      arr.splice(Number.isFinite(idx) ? Math.max(0, Math.min(idx, arr.length)) : arr.length, 0, key);
    }
    // Puts items into a category (its tray, or a tier row), taking them out of wherever they were.
    // Items in a done category are never moved out, and nothing goes into a done category.
    placeItems(nodeId, itemIds, rowId, idx) {
      return this.mutate((s) => {
        const n = s.nodes[nodeId];
        if (!n || n.done) return false;
        let at = idx, moved = 0;
        for (const id of itemIds) {
          if (!this.item(id)) continue;
          const home = this.placed.get(id);
          if (home && s.nodes[home] && s.nodes[home].done) continue;
          if (home && s.nodes[home]) this._remove(s.nodes[home], keyOf(id));
          this._insert(n, rowId || null, keyOf(id), at);
          if (Number.isFinite(at)) at++;
          moved++;
          this.placed.set(id, nodeId);
        }
        return moved || false;
      });
    }
    createCategory(o) {
      return this.mutate((s) => {
        const title = String(o.title || '').trim().slice(0, 60);
        if (!title) return false;
        const id = uid('n');
        s.nodes[id] = { id, title, color: o.color || PALETTE[s.order.length % PALETTE.length], done: false, rows: makeRows(), tray: [] };
        s.order.push(id);
        s.shown.push(id);
        for (const itemId of o.itemIds || []) {
          if (!this.item(itemId)) continue;
          const home = this.placed.get(itemId);
          if (home && s.nodes[home]) { if (s.nodes[home].done) continue; this._remove(s.nodes[home], keyOf(itemId)); }
          s.nodes[id].tray.push(keyOf(itemId));
          this.placed.set(itemId, id);
        }
        return id;
      });
    }
    // One category from a tag, filled with the item's that are still unrated.
    createFromTag(tag) {
      const ids = this.unratedItems().filter((i) => (i.tags || []).includes(tag)).map((i) => i.id);
      if (!ids.length) return false;
      const raw = tag.replace(/^#minecraft:/, '').split('/').pop().replace(/_/g, ' ');
      const title = raw.replace(/\b\w/g, (c) => c.toUpperCase());
      return this.createCategory({ title, itemIds: ids });
    }
    deleteCategory(id) {
      return this.mutate((s) => {
        const n = s.nodes[id];
        if (!n || n.done) return false;
        delete s.nodes[id];
        s.order = s.order.filter((x) => x !== id);
        s.shown = s.shown.filter((x) => x !== id);
      });
    }
    renameNode(id, title) {
      return this.mutate((s) => { const n = s.nodes[id], t = String(title || '').trim().slice(0, 60); if (!n || !t) return false; n.title = t; });
    }
    setColor(id, color) { return this.mutate((s) => { const n = s.nodes[id]; if (!n || !/^#[0-9a-f]{6}$/i.test(color)) return false; n.color = color; }); }
    // Reorder a category (tabs and columns follow this order). Saved with the progress.
    moveCategory(id, toIndex) {
      return this.mutate((s) => {
        const from = s.order.indexOf(id); if (from < 0) return false;
        const to = Math.max(0, Math.min(s.order.length - 1, toIndex)); if (from === to) return false;
        s.order.splice(from, 1); s.order.splice(to, 0, id);
      });
    }
    setIcon(id, itemId) { return this.mutate((s) => { const n = s.nodes[id]; if (!n) return false; n.icon = typeof itemId === 'string' ? itemId.slice(0, 80) : ''; }); }
    // The item shown on a category's tab: the one chosen, else the first ranked item, else the first in the tray.
    iconFor(n) {
      if (n.icon && this.itemMap.has(n.icon)) return n.icon;
      for (const r of n.rows) for (const k of r.entries) if (this.itemMap.has(k.slice(2))) return k.slice(2);
      for (const k of n.tray) if (this.itemMap.has(k.slice(2))) return k.slice(2);
      return null;
    }
    setDone(id, done) { return this.mutate((s) => { const n = s.nodes[id]; if (!n) return false; n.done = !!done; }); }
    moveEntry(nodeId, key, rowId, idx) { // reorder inside one category
      return this.mutate((s) => {
        const n = s.nodes[nodeId];
        if (!n || n.done || !this._remove(n, key)) return false;
        this._insert(n, rowId, key, idx);
      });
    }
    removeItems(itemIds) { // back to the unrated pool
      return this.mutate((s) => {
        let c = 0;
        for (const id of itemIds) {
          const home = this.placed.get(id);
          if (!home || !s.nodes[home] || s.nodes[home].done) continue;
          this._remove(s.nodes[home], keyOf(id)); c++;
        }
        return c || false;
      });
    }
    removeItem(id) { return this.removeItems([id]); }
    reorderCategory(id, toIndex) {
      return this.mutate((s) => {
        const i = s.order.indexOf(id);
        if (i < 0) return false;
        s.order.splice(i, 1);
        s.order.splice(Math.max(0, Math.min(toIndex, s.order.length)), 0, id);
      });
    }
    // Showing/hiding columns is view state: saved, but not an undo step.
    toggleShown(id) {
      const s = this.state;
      if (!s.nodes[id]) return;
      if (s.showAll) { s.showAll = false; s.shown = s.order.filter((x) => x !== id); }
      else s.shown = s.shown.includes(id) ? s.shown.filter((x) => x !== id) : s.shown.concat(id);
      this.emit('view');
    }
    setShowAll(on) { this.state.showAll = !!on; if (on) this.state.todo = false; this.emit('view'); }
    // Sort-card number keys 1-9: which category each one means. null = never edited (first nine, in tab order).
    getPins() { const p = this.state.pins || this.categories({ open: true }).slice(0, 9).map((n) => n.id); return Array.from({ length: 9 }, (_, i) => (this.state.nodes[p[i]] && !this.state.nodes[p[i]].done ? p[i] : null)); }
    setPins(arr) { this.state.pins = Array.from({ length: 9 }, (_, i) => (this.state.nodes[arr[i]] ? arr[i] : null)); this.emit('view'); }
    setTodo(on) { this.state.todo = !!on; this.emit('view'); }
    setMerged(on) { this.state.merged = !!on; this.emit('view'); }
    showOnly(id) { this.state.todo = false; this.state.showAll = false; this.state.shown = [id]; this.emit('view'); }
    setRows(nodeId, rows) {
      return this.mutate((s) => {
        const n = s.nodes[nodeId];
        if (!n || !rows.length || n.done) return false;
        const old = new Map(n.rows.map((r) => [r.id, r]));
        const next = rows.map((r) => {
          const prev = r.id && old.get(r.id);
          return { id: prev ? prev.id : uid('r'), label: String(r.label || '').trim() || '?', color: r.color || '#888888', entries: prev ? prev.entries : [] };
        });
        const kept = new Set(next.map((r) => r.id));
        for (const r of n.rows) if (!kept.has(r.id)) n.tray.push(...r.entries);
        n.rows = next;
      });
    }
    renameItems(map) {
      const sw = (k) => (map[k.slice(2)] ? keyOf(map[k.slice(2)]) : k);
      return this.mutate((s) => { for (const n of Object.values(s.nodes)) { for (const r of n.rows) r.entries = r.entries.map(sw); n.tray = n.tray.map(sw); } });
    }
    purgeItems(ids) {
      const gone = new Set(ids), ok = (k) => !gone.has(k.slice(2));
      return this.mutate((s) => {
        let changed = false;
        for (const n of Object.values(s.nodes)) {
          for (const r of n.rows) { const b = r.entries.length; r.entries = r.entries.filter(ok); if (r.entries.length !== b) changed = true; }
          const b = n.tray.length; n.tray = n.tray.filter(ok); if (n.tray.length !== b) changed = true;
        }
        return changed;
      });
    }
  }

  Store.DEFAULT_ROWS = DEFAULT_ROWS;
  Store.noisyTag = noisyTag;
  root.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
