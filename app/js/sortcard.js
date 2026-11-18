// Keyboard sort card: one random unrated item at a time. Press a category number, then a tier letter.
(function () {
  'use strict';
  const { h, toast } = U;
  const A = App.actions;
  const skipped = new Set();
  const recent = []; // category ids, most recently used first
  const used = (id) => { const i = recent.indexOf(id); if (i >= 0) recent.splice(i, 1); recent.unshift(id); };
  let open = null;

  const tierKeys = (n) => { // letter -> row, using each label's first character
    const map = new Map();
    n.rows.forEach((r) => { const k = (r.label || '').trim().charAt(0).toLowerCase(); if (k && !map.has(k)) map.set(k, r); });
    return map;
  };

  A.sortCard = () => {
    if (open) return;
    const store = App.store;
    if (!store.unratedItems().length) { toast('No unrated items left.'); return; }
    let cur = null, cat = null, suggested = null, lastPlaced = [], query = '';
    const back = h('div', { class: 'backdrop sort-back' });
    const box = h('div', { class: 'modal sortcard' });
    back.append(box);
    document.getElementById('modal-root').append(back);

    const cats = () => store.categories({ open: true });
    const slots = () => store.getPins().map((id) => (id ? store.node(id) : null));
    const pin = (id) => { const p = store.getPins(); const i = p.indexOf(null); if (p.includes(id)) return; if (i < 0) { toast('All 9 numbers are in use. Unpin one first (✕).'); return; } p[i] = id; store.setPins(p); paint(); };
    const unpin = (id) => { const p = store.getPins().map((x) => (x === id ? null : x)); store.setPins(p); paint(); };
    const draw = () => {
      const pool = store.unratedItems();
      if (!pool.length) { close(); toast('All items sorted.'); return false; }
      let c = pool.filter((i) => !skipped.has(i.id));
      if (!c.length) { skipped.clear(); c = pool; }
      cur = c[Math.floor(Math.random() * c.length)];
      const s = store.suggestFor(cur.id);
      suggested = s.length ? s[0].node.id : null;
      cat = null;
      return true;
    };
    const place = (row) => {
      const n = store.node(cat);
      if (!n) return;
      if (store.placeItems(n.id, [cur.id], row ? row.id : null, Infinity)) { lastPlaced.push(cur.id); query = ''; }
      if (draw()) paint();
    };
    const notSure = () => {
      let n = store.categories().find((x) => x.title === 'Not sure' && !x.done);
      let id = n && n.id;
      if (!id) id = store.createCategory({ title: 'Not sure', color: '#8fa0b5', itemIds: [] });
      if (store.placeItems(id, [cur.id], null, Infinity)) lastPlaced.push(cur.id);
      if (draw()) paint();
    };

    function paint() {
      const list = cats(), q = query.trim().toLowerCase(), sl = slots(), pinned = new Set(sl.filter(Boolean).map((n) => n.id));
      const rest = list.filter((n) => !pinned.has(n.id) && (!q || n.title.toLowerCase().includes(q)));
      const search = h('input', { class: 'dock-search sc-search', type: 'text', placeholder: '/  filter the list…', value: query });
      search.addEventListener('input', () => { query = search.value; const pos = search.selectionStart; paint(); const el = box.querySelector('.sc-search'); el.focus(); el.setSelectionRange(pos, pos); });
      search.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); const m = rest[0]; if (m) { cat = m.id; query = ''; paint(); } }
        else if (e.key === 'Escape') { e.preventDefault(); query = ''; paint(); }
      });
      const tgt = cat ? store.node(cat) : null;
      const left = h('div', { class: 'sc-left' },
        Tiers.spriteImg(cur, 'big'),
        h('h3', null, cur.name),
        A.flagText(cur) ? h('div', { class: 'muted flag-line' }, A.flagText(cur)) : null,
        h('div', { class: 'taglist sc-tags' }, ...(cur.tags || []).filter((t) => !Store.noisyTag(t, store.tagCounts().get(t) || 0)).slice(0, 10).map((t) => h('span', { class: 'tagchip' }, t))),
        h('div', { class: 'muted pool-note' }, store.unratedItems().length.toLocaleString() + ' left'));
      const mark = (n) => (suggested === n.id ? h('em', null, ' ★') : null);
      const tabs = h('div', { class: 'sc-cats' }, ...sl.map((n, i) => n
        ? h('div', { class: 'sc-slot' }, h('button', { class: 'sc-cat' + (cat === n.id ? ' active' : '') + (suggested === n.id && cat !== n.id ? ' suggested' : ''), style: { '--c': n.color }, onclick: () => { cat = n.id; paint(); } }, h('kbd', null, String(i + 1)), h('span', null, n.title), mark(n)),
          h('button', { class: 'icon-btn sc-x', title: 'Free this number', onclick: () => unpin(n.id) }, '✕'))
        : h('div', { class: 'sc-slot empty' }, h('kbd', null, String(i + 1)), h('span', { class: 'muted' }, 'free'))),
        h('button', { class: 'sc-cat', onclick: notSure }, h('kbd', null, 'N'), h('span', null, 'Not sure')));
      const listEl = h('div', { class: 'sc-list' }, ...rest.map((n) => h('div', { class: 'sc-li' + (cat === n.id ? ' active' : ''), style: { '--c': n.color } },
        h('button', { class: 'sc-li-main', onclick: () => { cat = n.id; paint(); } }, h('span', { class: 'dot' }), n.title, mark(n)),
        h('button', { class: 'btn small', title: 'Give this category a number key', onclick: () => pin(n.id) }, '+ number'))));
      if (!rest.length) listEl.append(h('div', { class: 'muted pad' }, q ? 'No other category matches.' : 'Every open category has a number.'));
      let right;
      if (!list.length) right = h('p', { class: 'muted' }, 'No open categories yet. Create one first (Esc, then “+ Category”), or press N to put items in “Not sure”.');
      else if (!tgt) {
        right = h('p', { class: 'muted' }, suggested ? 'Just press a tier letter to use the ★ category, or a number for another one.' : 'Press a number (or click a category in the list), then a tier letter.', ' Space skips.');
      } else {
        const keys = tierKeys(tgt), rev = new Map([...keys].map(([k, r]) => [r.id, k]));
        right = h('div', { class: 'sc-target' }, h('div', { class: 'sc-target-title' }, tgt.title),
          ...tgt.rows.map((r) => h('div', { class: 'sc-row' },
            h('button', { class: 'sc-tier', style: { background: r.color, color: U.contrastText(r.color) }, onclick: () => place(r) }, rev.has(r.id) && rev.get(r.id).toUpperCase() !== r.label.trim().toUpperCase() ? rev.get(r.id).toUpperCase() + ' ' + r.label : r.label),
            h('div', { class: 'sc-items' }, ...r.entries.slice(-14).map((k) => { const it = store.item(k.slice(2)); return it ? Tiers.spriteImg(it, 'sm') : null; }), r.entries.length > 14 ? h('span', { class: 'muted' }, '+' + (r.entries.length - 14)) : null))),
          h('div', { class: 'sc-row' }, h('button', { class: 'sc-tier plain', onclick: () => place(null) }, '- Unranked'), h('div', { class: 'muted' }, tgt.tray.length + ' in tray')));
      }
      box.replaceChildren(
        h('div', { class: 'modal-head' }, h('h2', null, 'Random item'), h('button', { class: 'icon-btn', onclick: close }, '✕')),
        h('div', { class: 'sc-body' }, left, h('div', { class: 'sc-right' }, tabs, search, listEl, right)),
        h('div', { class: 'sc-foot muted' }, h('span', null, '1–9 your pinned categories · click any in the list · / filter · tier letter alone = ★ category · - unranked · N not sure'), h('span', null, 'Space skip · Ctrl/Cmd+Z undo · Esc close')));
    }

    const onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const k = e.key, mod = e.metaKey || e.ctrlKey;
      if (k === 'Escape') { e.preventDefault(); close(); return; }
      if (mod && k.toLowerCase() === 'z') {
        e.preventDefault(); e.stopPropagation();
        if (lastPlaced.length && store.undo()) { const id = lastPlaced.pop(); cur = store.item(id); const s = store.suggestFor(id); suggested = s.length ? s[0].node.id : null; cat = null; paint(); }
        return;
      }
      if (mod || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      if (k === '/') { const el = box.querySelector('.sc-search'); if (el) el.focus(); return; }
      if (/^[1-9]$/.test(k)) { const n = slots()[Number(k) - 1]; if (n) { cat = n.id; paint(); } return; }
      if (k === 'Enter') { if (!cat && suggested) { cat = suggested; paint(); } return; }
      if (k === ' ') { skipped.add(cur.id); if (draw()) paint(); return; }
      if (k.toLowerCase() === 'n' && !cat) { notSure(); return; }
      if (!cat && suggested && store.node(suggested)) cat = suggested; // a tier letter alone uses the best match
      if (!cat) return;
      if (k === '-') { place(null); return; }
      const row = tierKeys(store.node(cat)).get(k.toLowerCase());
      if (row) place(row);
    };
    const onChange = (kind) => { if (kind === 'change' && cur && store.isRated(cur.id) && !lastPlaced.includes(cur.id)) { if (draw()) paint(); } };
    function close() {
      document.removeEventListener('keydown', onKey, true);
      unsub(); back.remove(); open = null;
    }
    const unsub = store.on(() => {});
    document.addEventListener('keydown', onKey, true);
    open = { close };
    if (draw()) paint();
  };
  A.sortCardOpen = () => !!open;
})();
