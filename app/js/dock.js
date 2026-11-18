// The dock: every unrated item along the bottom of the window. Select, filter, and drag onto tabs or tiers.
(function () {
  'use strict';
  const { h, toast } = U;
  const A = App.actions;
  const S = { open: true, query: '', tag: '', allTags: false, sort: 'name', onlyNew: false, removed: false, limit: 400 };
  let list = [];
  const ls = { get(k, d) { try { const v = localStorage.getItem('mctl.' + k); return v == null ? d : Number(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('mctl.' + k, String(v)); } catch (e) { /* ignore */ } } };
  S.h = ls.get('dockH', 0); S.tile = ls.get('dockTile', 48);
  const applySize = (root) => { root.style.setProperty('--dtile', S.tile + 'px'); if (S.h) root.style.height = S.h + 'px'; }; // ids currently shown, in order (for shift-click)

  function filtered() {
    const store = App.store;
    let arr = store.unratedItems(S.removed);
    if (S.tag && !arr.some((i) => (i.tags || []).includes(S.tag))) S.tag = '';
    if (S.onlyNew) arr = arr.filter((i) => i.new);
    if (S.tag) arr = arr.filter((i) => (i.tags || []).includes(S.tag));
    const q = S.query.trim().toLowerCase();
    if (q.startsWith('#')) arr = arr.filter((i) => (i.tags || []).some((t) => t.includes(q)));
    else if (q) arr = arr.filter((i) => i.name.toLowerCase().includes(q) || i.id.includes(q.replace(/\s+/g, '_')));
    if (S.sort === 'name') arr = arr.slice().sort((a, b) => a.name.localeCompare(b.name));
    else if (S.sort === 'name-desc') arr = arr.slice().sort((a, b) => b.name.localeCompare(a.name));
    else if (S.sort === 'new') arr = arr.slice().sort((a, b) => (b.new ? 1 : 0) - (a.new ? 1 : 0) || a.name.localeCompare(b.name));
    return arr;
  }

  function build() {
    const store = App.store;
    const all = filtered();
    list = all.map((i) => i.id);
    const counts = store.tagCounts();
    const tags = [...counts].filter(([t, c]) => S.allTags || !Store.noisyTag(t, c) || t === S.tag).sort((a, b) => a[0].localeCompare(b[0]));
    if (S.tag && !counts.has(S.tag)) S.tag = '';

    const search = h('input', { class: 'dock-search', type: 'text', placeholder: 'Filter by name or #tag…', value: S.query });
    search.addEventListener('input', () => { S.query = search.value; S.limit = 400; refill(); });
    const tagSel = U.select({ value: S.tag, title: 'Filter by item tag', options: [{ value: '', label: 'Any tag' }, ...tags.map(([t, c]) => ({ value: t, label: t + ' (' + c + ')' }))], onChange: (v) => { S.tag = v; S.limit = 400; render(); } });
    const allBox = h('input', { type: 'checkbox' }); allBox.checked = S.allTags;
    allBox.addEventListener('change', () => { S.allTags = allBox.checked; render(); });
    const sortSel = U.select({ value: S.sort, options: [{ value: 'name', label: 'A \u2192 Z' }, { value: 'name-desc', label: 'Z \u2192 A' }, { value: 'new', label: 'New first' }], onChange: (v) => { S.sort = v; render(); } });

    const newCount = store.library.items.filter((i) => i.new && !i.removedIn && !store.isRated(i.id)).length;
    const remCount = store.library.items.filter((i) => i.removedIn && !store.isRated(i.id)).length;
    const chip = (label, on, fn) => h('label', { class: 'check chip' }, (() => { const b = h('input', { type: 'checkbox' }); b.checked = on; b.addEventListener('change', () => fn(b.checked)); return b; })(), h('span', null, label));

    const count = h('span', { class: 'muted dock-count' });
    const paintCount = () => { count.textContent = all.length.toLocaleString() + ' unrated' + (App.sel.size ? ' · ' + App.sel.size + ' selected' : ''); };
    paintCount();
    Tiers.onSel(paintCount);

    const zoom = h('input', { type: 'range', min: '24', max: '96', step: '4', value: String(S.tile), class: 'dock-zoom', title: 'Item size' });
    zoom.addEventListener('input', () => { S.tile = Number(zoom.value); ls.set('dockTile', S.tile); const r = document.querySelector('.dock'); if (r) r.style.setProperty('--dtile', S.tile + 'px'); });
    const bar = h('div', { class: 'dock-bar' },
      h('button', { class: 'icon-btn', title: S.open ? 'Collapse the dock' : 'Expand the dock', onclick: () => { S.open = !S.open; render(); } }, S.open ? '▾' : '▴'),
      h('strong', null, 'Unrated'), count,
      S.open ? [zoom, search, tagSel, h('label', { class: 'check', title: 'Include very broad or very small tags' }, allBox, h('span', { class: 'muted' }, 'all tags')), sortSel] : null,
      S.open && newCount ? chip('New in ' + (store.library.version || 'this version') + ' (' + newCount + ')', S.onlyNew, (v) => { S.onlyNew = v; render(); }) : null,
      S.open && remCount ? chip('Removed (' + remCount + ')', S.removed, (v) => { S.removed = v; render(); }) : null,
      h('span', { class: 'spacer' }),
      S.open ? [
        h('button', { class: 'btn small', onclick: () => { list.forEach((id) => App.sel.add(id)); Tiers.paintSel(); } }, 'Select all shown'),
        h('button', { class: 'btn small', disabled: !App.sel.size, onclick: () => Tiers.clearSel() }, 'Clear'),
        S.tag ? h('button', { class: 'btn small primary', title: 'New category holding every unrated item with this tag', onclick: () => A.categoryFromTag(S.tag) }, 'Category from this tag') : null,
        h('button', { class: 'btn small', disabled: !App.sel.size, onclick: () => A.newCategory([...App.sel], () => { App.sel.clear(); }) }, 'Category from selection'),
      ] : null,
      null);

    const grid = h('div', { class: 'dock-grid' });
    const fill = () => {
      grid.replaceChildren();
      const frag = document.createDocumentFragment();
      all.slice(0, S.limit).forEach((it) => {
        const t = h('div', { class: 'tile dock-tile' + (App.sel.has(it.id) ? ' sel' : '') + (it.removedIn ? ' is-removed' : ''), draggable: 'true', dataset: { item: it.id }, title: it.name + (A.flagText(it) ? ' · ' + A.flagText(it) : '') },
          Tiers.spriteImg(it), it.new ? h('span', { class: 'flag' }, 'NEW') : null);
        t.addEventListener('dragstart', (e) => Tiers.startDrag(e, t, it.id, 'dock'));
        t.addEventListener('dragend', () => Tiers.endDrag(t));
        t.addEventListener('click', (e) => Tiers.selectClick(e, it.id, list));
        t.addEventListener('contextmenu', (e) => { e.preventDefault(); A.itemMenu(e, it.id); });
        frag.append(t);
      });
      grid.append(frag);
      if (all.length > S.limit) grid.append(h('button', { class: 'btn small more', onclick: () => { S.limit += 600; render(); } }, 'Show ' + Math.min(600, all.length - S.limit) + ' more'));
      if (!all.length) grid.append(h('div', { class: 'muted dock-empty' }, store.library.items.length ? 'Nothing matches — or everything is sorted.' : 'Your library is empty. Use ⋯ › Import items from Minecraft.'));
    };
    const refill = () => { const sc = grid.scrollTop; const a = filtered(); all.length = 0; all.push(...a); list = all.map((i) => i.id); paintCount(); fill(); grid.scrollTop = sc; };
    fill();
    // dropping a ranked item on the dock un-ranks it
    const grip = h('div', { class: 'dock-grip', title: 'Drag to resize (double-click to reset)' });
    const root = h('div', { class: 'dock' + (S.open ? '' : ' collapsed') }, S.open ? grip : null, bar, S.open ? grid : null);
    applySize(root);
    if (!S.open) root.style.height = '';
    grip.addEventListener('dblclick', () => { S.h = 0; ls.set('dockH', 0); root.style.height = ''; });
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY, startH = root.getBoundingClientRect().height;
      const move = (ev) => { S.h = Math.round(Math.max(90, Math.min(window.innerHeight * 0.85, startH + (startY - ev.clientY)))); root.style.height = S.h + 'px'; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); ls.set('dockH', S.h); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    root.addEventListener('dragover', (e) => { if (document.body.classList.contains('dragging-items')) { e.preventDefault(); root.classList.add('drop-over'); } });
    root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop-over'); });
    root.addEventListener('drop', (e) => {
      e.preventDefault(); root.classList.remove('drop-over');
      const ids = (e.dataTransfer.getData('text/plain') || '').split(',').filter((x) => App.store.isRated(x));
      Tiers.endDrag(null); App.sel.clear();
      if (ids.length && App.store.removeItems(ids)) toast(ids.length + ' item' + (ids.length === 1 ? '' : 's') + ' back to unrated.');
    });
    return { root, grid, search };
  }

  let mounted = null;
  function render() {
    const host = document.getElementById('dock-root');
    if (!host) return;
    const keep = mounted ? { sc: mounted.grid.scrollTop, focus: document.activeElement === mounted.search, pos: mounted.search.selectionStart } : null;
    mounted = build();
    host.replaceChildren(mounted.root);
    if (keep) { mounted.grid.scrollTop = keep.sc; if (keep.focus) { mounted.search.focus(); mounted.search.setSelectionRange(keep.pos, keep.pos); } }
    document.body.classList.toggle('dock-collapsed', !S.open);
  }

  A.renderDock = render;
  A.dockToggle = () => { S.open = !S.open; render(); };
})();
