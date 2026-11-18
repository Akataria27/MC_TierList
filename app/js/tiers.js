// Columns view: one column per visible category, with tier rows, tiles, selection and drag-and-drop.
(function () {
  'use strict';
  const { h, contrastText } = U;

  let drag = null; // { ids: [itemId], from: 'dock' | categoryId }
  App.sel = new Set();
  App.anchor = null;
  const selListeners = new Set();
  const onSel = (fn) => selListeners.add(fn);

  function imgUrl(item) {
    return 'app://local/items/' + encodeURIComponent(item.img) + '?v=' + App.store.library.rev;
  }

  function spriteImg(item, cls) {
    const img = h('img', { class: 'px ' + (cls || ''), src: imgUrl(item), alt: item.name, draggable: 'false', loading: 'lazy', decoding: 'async' });
    // 64px renders of blocks look better smoothed; 16px sprites stay crisp
    img.addEventListener('load', () => { if (img.naturalWidth > 32) img.classList.add('smooth'); });
    // A load can fail transiently when many icons are requested at once, so retry before showing "?"
    let tries = 0;
    img.addEventListener('error', () => {
      if (tries++ < 3) setTimeout(() => { img.src = imgUrl(item) + '&r=' + tries; }, 150 * tries * tries);
      else img.replaceWith(h('div', { class: 'px missing ' + (cls || '') }, '?'));
    });
    return img;
  }

  // ---- selection ----------------------------------------------------------
  function paintSel() {
    document.querySelectorAll('[data-item]').forEach((el) => el.classList.toggle('sel', App.sel.has(el.dataset.item)));
    selListeners.forEach((fn) => fn());
  }
  // order: the ids of the tiles in the same container, for shift-click ranges
  function selectClick(e, itemId, order) {
    if (e.shiftKey && App.anchor && order.includes(App.anchor) && order.includes(itemId)) {
      const a = order.indexOf(App.anchor), b = order.indexOf(itemId);
      for (const id of order.slice(Math.min(a, b), Math.max(a, b) + 1)) App.sel.add(id);
    } else if (e.metaKey || e.ctrlKey) {
      if (App.sel.has(itemId)) App.sel.delete(itemId); else App.sel.add(itemId);
      App.anchor = itemId;
    } else {
      const only = App.sel.size === 1 && App.sel.has(itemId);
      App.sel.clear();
      if (!only) { App.sel.add(itemId); App.anchor = itemId; }
    }
    paintSel();
  }
  function clearSel() { if (App.sel.size) { App.sel.clear(); paintSel(); } }

  // ---- drag and drop ------------------------------------------------------
  function dragImage(count) {
    const g = h('div', { class: 'drag-ghost' }, count + (count === 1 ? ' item' : ' items'));
    document.body.append(g);
    setTimeout(() => g.remove(), 0);
    return g;
  }
  function startDrag(e, tile, itemId, from) {
    if (!App.sel.has(itemId)) { App.sel.clear(); App.sel.add(itemId); App.anchor = itemId; paintSel(); }
    drag = { ids: [...App.sel], from };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', drag.ids.join(','));
    if (drag.ids.length > 1) e.dataTransfer.setDragImage(dragImage(drag.ids.length), 10, 10);
    document.body.classList.add('dragging-items');
    requestAnimationFrame(() => tile.classList.add('dragging'));
  }
  function endDrag(tile) {
    drag = null;
    if (tile) tile.classList.remove('dragging');
    document.body.classList.remove('dragging-items');
    clearInsert();
    document.querySelectorAll('.drop-over').forEach((z) => z.classList.remove('drop-over'));
  }
  function clearInsert() { document.querySelectorAll('.ins-before, .ins-after').forEach((el) => el.classList.remove('ins-before', 'ins-after')); }
  const zoneTiles = (zone) => [...zone.querySelectorAll(':scope > .tile:not(.dragging)')];
  function insertIndex(zone, x, y) {
    const tiles = zoneTiles(zone);
    for (let i = 0; i < tiles.length; i++) {
      const r = tiles[i].getBoundingClientRect();
      if (!(y > r.bottom || (y >= r.top && x > r.left + r.width / 2))) return i;
    }
    return tiles.length;
  }
  function showInsert(zone, x, y) {
    clearInsert();
    const tiles = zoneTiles(zone);
    if (!tiles.length) return;
    const idx = insertIndex(zone, x, y);
    if (idx < tiles.length) tiles[idx].classList.add('ins-before'); else tiles[tiles.length - 1].classList.add('ins-after');
  }
  const canDrop = (nodeId) => drag && !App.store.isDone(nodeId);
  function wireZone(zone, nodeId, rowId) {
    zone.addEventListener('dragover', (e) => {
      if (!canDrop(nodeId)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drop-over');
      showInsert(zone, e.clientX, e.clientY);
    });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) { zone.classList.remove('drop-over'); clearInsert(); } });
    zone.addEventListener('drop', (e) => {
      if (!canDrop(nodeId)) return;
      e.preventDefault();
      const idx = insertIndex(zone, e.clientX, e.clientY), d = drag;
      endDrag(null);
      App.sel.clear();
      App.store.placeItems(nodeId, d.ids, rowId, idx);
    });
  }
  // A tab or a column header accepts drops too: the items go to that category's tray.
  function wireTarget(el, nodeId) {
    el.addEventListener('dragover', (e) => { if (!canDrop(nodeId)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
    el.addEventListener('drop', (e) => {
      if (!canDrop(nodeId)) return;
      e.preventDefault();
      const d = drag;
      endDrag(null);
      App.sel.clear();
      const n = App.store.placeItems(nodeId, d.ids, null, Infinity);
      if (n) U.toast(n + ' item' + (n === 1 ? '' : 's') + ' → ' + App.store.node(nodeId).title);
    });
  }

  // ---- tiles --------------------------------------------------------------
  function itemTile(node, itemId, order) {
    const store = App.store, it = store.item(itemId), locked = node.done;
    const t = h('div', {
      class: 'tile item-tile' + (locked ? ' locked' : ''),
      draggable: locked ? 'false' : 'true',
      dataset: { item: itemId },
      title: it ? it.name + (it.removedIn ? ' · removed in ' + it.removedIn : '') : itemId + ' (not in library)',
    });
    t.append(it ? spriteImg(it) : h('div', { class: 'px missing' }, '?'));
    if (it && it.removedIn) t.append(h('span', { class: 'badge removed-badge', title: 'Removed in ' + it.removedIn }, '⊘'));
    if (App.sel.has(itemId)) t.classList.add('sel');
    t.addEventListener('dragstart', (e) => startDrag(e, t, itemId, node.id));
    t.addEventListener('dragend', () => endDrag(t));
    t.addEventListener('click', (e) => { e.stopPropagation(); selectClick(e, itemId, order); });
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); App.actions.itemMenu(e, itemId); });
    return t;
  }

  function rowEl(node, row, order) {
    const label = h('div', { class: 'tier-label', style: { background: row.color, color: contrastText(row.color) } }, h('span', null, row.label));
    const zone = h('div', { class: 'tier-zone zone', dataset: { row: row.id } });
    row.entries.forEach((k) => zone.append(itemTile(node, k.slice(2), order)));
    wireZone(zone, node.id, row.id);
    return h('div', { class: 'tier-row' }, label, zone);
  }

  function column(node) {
    const store = App.store;
    const order = store.allKeys(node).map((k) => k.slice(2));
    const head = h('div', { class: 'col-head' },
      h('span', { class: 'dot' }),
      h('div', { class: 'col-title', title: node.title }, node.title + (node.done ? ' ✓' : '')),
      h('span', { class: 'muted col-count' }, order.length),
      h('button', { class: 'icon-btn', title: 'Category options', onclick: (e) => { e.stopPropagation(); App.actions.catMenu(e, node.id); } }, '⋯'),
      h('button', { class: 'icon-btn', title: 'Hide this column', onclick: () => store.toggleShown(node.id) }, '✕'));
    wireTarget(head, node.id);
    const body = h('div', { class: 'col-body' });
    if (node.done) {
      const fresh = store.newMatchesFor(node.id).length;
      body.append(h('div', { class: 'done-banner' }, '✓ Done. Locked: nothing can be moved in or out.'
        + (fresh ? ' ' + fresh + ' new item' + (fresh === 1 ? '' : 's') + ' look like they belong here; reopen to add them.' : '')));
    }
    const trayZone = h('div', { class: 'tray-zone zone', dataset: { row: '' } });
    node.tray.forEach((k) => trayZone.append(itemTile(node, k.slice(2), order)));
    if (!node.tray.length) trayZone.append(h('span', { class: 'muted tray-empty' }, 'Drop items here to add them without ranking.'));
    wireZone(trayZone, node.id, null);
    body.append(h('div', { class: 'tray' }, h('div', { class: 'tray-head' }, h('strong', null, 'Not ranked yet'), h('span', { class: 'muted' }, ' (' + node.tray.length + ')')), trayZone));
    body.append(h('div', { class: 'tiers' }, ...node.rows.map((r) => rowEl(node, r, order))));
    return h('section', { class: 'col' + (node.done ? ' is-done' : ''), style: { '--c': node.color }, dataset: { cat: node.id } }, head, body);
  }

  function renderColumns() {
    const store = App.store, cols = store.visible();
    const wrap = h('div', { class: 'cols' });
    if (!store.categories().length) {
      wrap.append(h('div', { class: 'empty-hint' }, h('strong', null, 'No categories yet.'),
        h('span', null, ' Make one with “+ Category”, or use the dock below: pick a tag in the dock and press “Category from this tag”, or select items and drag them onto a tab.')));
    } else if (!cols.length) {
      wrap.append(h('div', { class: 'empty-hint' }, h('strong', null, 'Nothing is shown.'), h('span', null, ' Click a tab above to show its column, or press “View all”.')));
    }
    cols.forEach((n) => wrap.append(column(n)));
    wrap.addEventListener('click', (e) => { if (!e.target.closest('.tile')) clearSel(); });
    return wrap;
  }


  // Dropping on a merged tier moves each item to the same-named tier of ITS OWN category.
  function mergedZone(t, cats, ...tiles) {
    const zone = h('div', { class: 'tier-zone zone' }, ...tiles);
    zone.addEventListener('dragover', (e) => { if (!drag) return; e.preventDefault(); zone.classList.add('drop-over'); });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop-over'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      const d = drag; endDrag(null); App.sel.clear();
      if (!d) return;
      const store = App.store, key = t.label.trim().toLowerCase();
      let moved = 0, skipped = 0;
      for (const id of d.ids) {
        const home = store.homeOf(id), n = home && store.node(home);
        const row = n && !n.done && n.rows.find((r) => r.label.trim().toLowerCase() === key);
        if (row) { moved += store.placeItems(n.id, [id], row.id, Infinity) ? 1 : 0; } else skipped++;
      }
      if (skipped) U.toast(skipped + ' item' + (skipped === 1 ? '' : 's') + ' not moved: only items already in a category (with this tier) can be moved in Merged view.');
    });
    return zone;
  }
  // One cohesive list: tiers with the same label are combined across the visible categories.
  // Display only - items keep their own category, shown by the coloured border.
  function renderMerged() {
    const store = App.store;
    let cats = store.visible(); if (!cats.length) cats = store.categories();
    const wrap = h('div', { class: 'cols merged' });
    if (!cats.length) { wrap.append(h('div', { class: 'empty-hint' }, 'No categories to merge yet.')); return wrap; }
    const tiers = [], byLabel = new Map();
    for (const n of cats) for (const r of n.rows) {
      const k = r.label.trim().toLowerCase();
      if (!byLabel.has(k)) { const t = { label: r.label, color: r.color, items: [] }; byLabel.set(k, t); tiers.push(t); }
      r.entries.forEach((e) => byLabel.get(k).items.push({ id: e.slice(2), node: n }));
    }
    const rest = []; cats.forEach((n) => n.tray.forEach((e) => rest.push({ id: e.slice(2), node: n })));
    const order = []; tiers.forEach((t) => t.items.forEach((x) => order.push(x.id))); rest.forEach((x) => order.push(x.id));
    const tile = (x) => { const t = itemTile(x.node, x.id, order); t.style.borderColor = x.node.color; t.style.boxShadow = 'inset 0 0 0 1px ' + x.node.color; t.title += ' · ' + x.node.title; return t; };
    const panel = h('section', { class: 'col merged-col', style: { '--c': '#888' } });
    panel.append(h('div', { class: 'col-head' }, h('div', { class: 'col-title' }, 'Merged'), h('span', { class: 'muted col-count' }, order.length)));
    const body = h('div', { class: 'col-body' }, h('div', { class: 'tiers' }, ...tiers.map((t) => h('div', { class: 'tier-row' },
      h('div', { class: 'tier-label', style: { background: t.color, color: contrastText(t.color) } }, h('span', null, t.label)),
      mergedZone(t, cats, ...t.items.map(tile))))));
    if (rest.length) body.append(h('div', { class: 'tray' }, h('div', { class: 'tray-head' }, h('strong', null, 'Not ranked yet'), h('span', { class: 'muted' }, ' (' + rest.length + ')')), h('div', { class: 'tray-zone zone' }, ...rest.map(tile))));
    panel.append(body); wrap.append(panel);
    wrap.addEventListener('click', (e) => { if (!e.target.closest('.tile')) clearSel(); });
    return wrap;
  }

  window.Tiers = { renderMerged, renderColumns, spriteImg, imgUrl, startDrag, endDrag, selectClick, paintSel, clearSel, wireTarget, onSel };
})();
