// Dialogs and menus: tier editor, category dialogs, context menus, share codes.
(function () {
  'use strict';
  const { h, toast, popMenu, openModal, confirmDialog, promptDialog } = U;
  window.App = window.App || { store: null, actions: {} };
  const A = window.App.actions;

  const PALETTE = ['#e0645c', '#e0b84a', '#4fb3d9', '#7bc96f', '#b07be0', '#e08a4f', '#5fc9b0', '#d96fa6', '#8fa0b5', '#a3c94f'];

  // ---- tags ---------------------------------------------------------------
  function tagList(it) {
    return h('div', { class: 'taglist' }, it.tags && it.tags.length
      ? it.tags.map((t) => h('span', { class: 'tagchip' }, t))
      : h('span', { class: 'muted' }, 'No tags'));
  }
  const flagText = (it) => (it.removedIn ? 'Removed in ' + it.removedIn : it.new ? 'New in ' + (it.since || App.store.library.version) : '');
  A.flagText = flagText;

  // ---- category dialogs -----------------------------------------------------
  // Name + colour. onDone(title, color). Optional itemIds are shown as a count.
  function categoryForm({ title, name, color, confirmLabel, note, onDone }) {
    const m = openModal({ title });
    let chosen = color || PALETTE[App.store.state.order.length % PALETTE.length];
    const input = h('input', { type: 'text', class: 'txt', value: name || '', maxlength: '60', placeholder: 'Category name, e.g. Swords' });
    const swatches = h('div', { class: 'swatches' });
    const draw = () => {
      swatches.replaceChildren(...PALETTE.map((c) => h('button', { class: 'swatch' + (c === chosen ? ' on' : ''), style: { background: c }, title: c, onclick: () => { chosen = c; draw(); } })));
    };
    draw();
    const go = () => { const t = input.value.trim(); if (!t) { input.focus(); return; } m.close(); onDone(t, chosen); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    m.body.append(note ? h('p', { class: 'dialog-text' }, note) : null, input, swatches,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, confirmLabel || 'Create')));
    setTimeout(() => input.focus(), 30);
  }

  A.newCategory = (itemIds, after) => {
    const ids = (itemIds || []).filter((id) => !App.store.isDone(App.store.homeOf(id)));
    categoryForm({
      title: 'New category',
      note: ids.length ? ids.length + ' selected item' + (ids.length === 1 ? '' : 's') + ' will go into its tray.' : 'You can drag items onto its tab afterwards.',
      onDone: (t, c) => { const id = App.store.createCategory({ title: t, color: c, itemIds: ids }); if (id && after) after(id); },
    });
  };

  A.categoryFromTag = (tag) => {
    const store = App.store;
    const n = store.unratedItems().filter((i) => (i.tags || []).includes(tag)).length;
    if (!n) { toast('No unrated items carry that tag.'); return; }
    const raw = tag.replace(/^#minecraft:/, '').split('/').pop().replace(/_/g, ' ');
    categoryForm({
      title: 'Category from ' + tag, name: raw.replace(/\b\w/g, (c) => c.toUpperCase()),
      note: n + ' unrated item' + (n === 1 ? '' : 's') + ' with this tag will go into the new category’s tray.',
      onDone: (t, c) => { const id = store.createCategory({ title: t, color: c, itemIds: store.unratedItems().filter((i) => (i.tags || []).includes(tag)).map((i) => i.id) }); if (id) toast('Created “' + t + '” with ' + n + ' items.'); },
    });
  };

  async function renameNode(id) {
    const n = App.store.node(id);
    const t = await promptDialog({ title: 'Rename', label: 'Name', value: n.title });
    if (t) App.store.renameNode(id, t);
  }
  async function deleteNode(id) {
    const store = App.store, n = store.node(id), items = store.countItems(id);
    const ok = await confirmDialog({
      title: 'Delete “' + n.title + '”?',
      message: 'This removes the category and its tier placements. The ' + items + ' item' + (items === 1 ? '' : 's') + ' inside go back to the unrated pool. You can undo this.',
      confirmLabel: 'Delete', danger: true,
    });
    if (ok) store.deleteCategory(id);
  }
  function toggleDone(id) {
    const store = App.store, n = store.node(id);
    if (!n) return;
    const next = !n.done;
    store.setDone(id, next);
    toast(next ? '“' + n.title + '” is marked done and locked.' : '“' + n.title + '” is open again.', [{ label: 'Undo', onClick: () => store.undo() }]);
  }

  // ---- tier editor ------------------------------------------------------------
  function editTiers(nodeId) {
    const store = App.store;
    const node = store.node(nodeId);
    if (!node) return;
    const rows = node.rows.map((r) => ({ id: r.id, label: r.label, color: r.color }));
    const m = openModal({ title: 'Edit tiers – ' + node.title });
    const listEl = h('div', { class: 'rows-edit' });
    function draw() {
      listEl.replaceChildren();
      rows.forEach((r, i) => {
        const label = h('input', { type: 'text', class: 'txt row-label', value: r.label, maxlength: '14' });
        label.addEventListener('input', () => { r.label = label.value; });
        const color = h('input', { type: 'color', value: r.color });
        color.addEventListener('input', () => { r.color = color.value; });
        listEl.append(h('div', { class: 'row-edit' },
          h('button', { class: 'icon-btn', disabled: i === 0, title: 'Move up', onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); } }, '▲'),
          h('button', { class: 'icon-btn', disabled: i === rows.length - 1, title: 'Move down', onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); } }, '▼'),
          label, color,
          h('button', { class: 'icon-btn danger', disabled: rows.length <= 1, title: 'Remove tier (its tiles go to the tray)', onclick: () => { rows.splice(i, 1); draw(); } }, '✕')));
      });
    }
    draw();
    m.body.append(
      listEl,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { rows.push({ id: null, label: 'New', color: '#cccccc' }); draw(); } }, 'Add tier'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { store.setRows(nodeId, rows); m.close(); } }, 'Save tiers')));
  }


  // Choose which item is shown on a category's tab.
  A.pickIcon = (nodeId) => {
    const store = App.store, n = store.node(nodeId);
    if (!n) return;
    const m = openModal({ title: 'Tab icon for ' + n.title, wide: true });
    const search = h('input', { type: 'text', class: 'txt', placeholder: 'Search items…' });
    const grid = h('div', { class: 'icon-grid' });
    const note = h('div', { class: 'muted icon-note' });
    const own = store.library.items.filter((i) => !i.removedIn).slice().sort((a, b) => a.name.localeCompare(b.name));
    // Items already in this category come first: they are the likeliest choice.
    const inCat = new Set(store.allKeys(n).map((k) => k.slice(2)));
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      let list = own.filter((i) => !q || i.name.toLowerCase().includes(q) || i.id.includes(q.replace(/\s+/g, '_')));
      if (!q) list = list.filter((i) => inCat.has(i.id)).concat(list.filter((i) => !inCat.has(i.id)));
      note.textContent = list.length > 300 ? 'Showing 300 of ' + list.length.toLocaleString() + '. Type to narrow it down.' : list.length + ' item' + (list.length === 1 ? '' : 's');
      grid.replaceChildren(...list.slice(0, 300).map((it) => {
        const b = h('button', { class: 'icon-pick' + (n.icon === it.id ? ' on' : ''), title: it.name, onclick: () => { store.setIcon(nodeId, it.id); m.close(); } }, Tiers.spriteImg(it));
        return b;
      }));
    };
    search.addEventListener('input', fill);
    m.body.append(h('p', { class: 'dialog-text' }, 'Pick the item that stands for this category on its tab. Items in this category are listed first.'), search, note, grid,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { store.setIcon(nodeId, ''); m.close(); } }, 'Use the first item automatically'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel')));
    fill();
    setTimeout(() => search.focus(), 0);
  };

  // ---- menus ------------------------------------------------------------------
  // Category column / tab menu.
  A.catMenu = (e, id) => {
    const store = App.store, n = store.node(id);
    if (!n) return;
    const r = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
    const shown = store.state.showAll || store.state.shown.includes(id);
    popMenu(r.left, r.bottom + 4, [
      { header: true, label: n.title + (n.done ? ' ✓ done' : '') },
      { label: shown ? 'Hide column' : 'Show column', onClick: () => store.toggleShown(id) },
      { label: 'Show only this', onClick: () => store.showOnly(id) },
      '-',
      { label: n.done ? 'Reopen (remove done mark)' : 'Mark as done ✓', onClick: () => toggleDone(id) },
      { label: 'Tab icon…', onClick: () => A.pickIcon(id) },
      { label: 'Rename…', onClick: () => renameNode(id) },
      { label: 'Colour…', onClick: () => categoryForm({ title: 'Colour – ' + n.title, name: n.title, color: n.color, confirmLabel: 'Save', onDone: (t, c) => { store.renameNode(id, t); store.setColor(id, c); } }) },
      { label: 'Edit tiers…', disabled: n.done, onClick: () => editTiers(id) },
      { label: 'Save as image…', onClick: () => A.exportImage(id) },
      '-',
      { label: n.done ? 'Delete category… (reopen first)' : 'Delete category…', danger: true, disabled: n.done, onClick: () => deleteNode(id) },
    ]);
  };

  // Right-click on an item tile (in a column or in the dock): name, tags and actions for the selection.
  A.itemMenu = (e, itemId) => {
    const store = App.store, it = store.item(itemId);
    if (!it) return;
    const ids = App.sel.has(itemId) && App.sel.size > 1 ? [...App.sel] : [itemId];
    const home = store.homeOf(itemId), locked = home && store.isDone(home);
    const cats = store.categories({ open: true });
    const items = [{ header: true, label: ids.length > 1 ? ids.length + ' items selected' : it.name },
      { el: h('div', { class: 'menu-info' }, h('div', { class: 'muted mono' }, it.id + (home ? ' · in ' + store.node(home).title : '')), flagText(it) ? h('div', { class: 'flag-line' }, flagText(it)) : null,
        h('div', { class: 'muted menu-tags-title' }, (it.tags || []).length + ' tag' + ((it.tags || []).length === 1 ? '' : 's')), tagList(it)) },
      '-'];
    const sug = store.suggestFor(itemId).slice(0, 3).map((x) => x.node.id);
    const ordered = sug.concat(cats.map((c) => c.id).filter((id) => !sug.includes(id)));
    ordered.slice(0, 8).forEach((id) => items.push({ label: (sug.includes(id) ? '★ ' : '') + 'Move to ' + store.node(id).title, onClick: () => { store.placeItems(id, ids); App.sel.clear(); } }));
    items.push({ label: 'New category from selection…', onClick: () => A.newCategory(ids) });
    if (home) items.push('-', { label: locked ? 'Remove (category is done)' : 'Remove (back to unrated)', danger: true, disabled: locked, onClick: () => { store.removeItems(ids); App.sel.clear(); } });
    popMenu(e.clientX, e.clientY, items);
  };

  // ---- share / load code ------------------------------------------------
  function openShare() {
    const store = App.store;
    const modal = openModal({ title: 'Share or load progress', wide: true });

    // Send
    const info = h('div', { class: 'muted' });
    const codeBox = h('textarea', { class: 'code-box', readonly: true, rows: '4', spellcheck: 'false' });
    codeBox.value = 'Generating…';
    const copyBtn = h('button', { class: 'btn primary', disabled: true }, 'Copy code');
    const saveBtn = h('button', { class: 'btn', disabled: true }, 'Save code as file…');
    let code = '';
    const ranked = store.placed.size;
    Share.encode(store.state, { version: store.library.version, count: store.library.items.length }).then((c) => {
      code = c;
      codeBox.value = c;
      info.textContent = ranked.toLocaleString() + ' ranked items in ' + store.categories().length + ' categories · ' + c.length.toLocaleString() + ' characters'
        + (store.library.version ? ' · items from Minecraft ' + store.library.version : '');
      copyBtn.disabled = false;
      saveBtn.disabled = false;
    });
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
      } catch (e) {
        codeBox.focus();
        codeBox.select();
        document.execCommand('copy');
      }
      toast('Code copied. Paste it to your friend.');
    });
    saveBtn.addEventListener('click', async () => {
      const r = await window.api.saveText(code, 'tier-list-code.txt');
      if (r && r.ok) toast('Saved to ' + r.path);
    });

    // Receive
    const pasteBox = h('textarea', { class: 'code-box', rows: '4', spellcheck: 'false', placeholder: 'Paste a code here…' });
    const status = h('div', { class: 'code-status muted' });
    const loadBtn = h('button', { class: 'btn danger', disabled: true }, 'Replace my progress with this code');
    const fileBtn = h('button', { class: 'btn' }, 'Load code from file…');
    let decoded = null;
    let token = 0;
    async function check() {
      const mine = ++token;
      decoded = null;
      loadBtn.disabled = true;
      const text = pasteBox.value;
      if (!text.trim()) { status.className = 'code-status muted'; status.textContent = ''; return; }
      status.className = 'code-status muted';
      status.textContent = 'Checking…';
      try {
        const d = await Share.decode(text);
        if (mine !== token) return;
        const missing = d.summary.missingFrom(store.itemMap);
        const lines = ['Valid code: ' + d.summary.items.toLocaleString() + ' ranked items in ' + d.summary.categories + ' categories.'];
        if (d.lib.version) lines.push('Made with Minecraft ' + d.lib.version + ' items' + (d.lib.count ? ' (' + d.lib.count.toLocaleString() + ' in its library)' : '') + '.');
        if (d.lib.version && store.library.version && d.lib.version !== store.library.version) lines.push('Your library is ' + store.library.version + '.');
        lines.push(missing
          ? missing.toLocaleString() + ' of its items are not in your library, so they show as "?" tiles until you import the same version’s files.'
          : 'Every item in it is in your library.');
        lines.push('Loading replaces your current progress. A backup is saved first, and you can undo until you quit.');
        status.className = 'code-status ok';
        status.textContent = lines.join(' ');
        decoded = d;
        loadBtn.disabled = false;
      } catch (e) {
        if (mine !== token) return;
        status.className = 'code-status bad';
        status.textContent = e.message;
      }
    }
    const recheck = U.debounce(check, 250);
    pasteBox.addEventListener('input', recheck);
    fileBtn.addEventListener('click', async () => {
      const r = await window.api.openText();
      if (!r || r.canceled) return;
      if (r.error) { toast(r.error, null, 6000); return; }
      pasteBox.value = r.text;
      check();
    });
    loadBtn.addEventListener('click', async () => {
      if (!decoded) return;
      loadBtn.disabled = true;
      await window.api.saveProgress(store.state);
      await window.api.backupNow();
      store.replaceState(decoded.state);
      modal.close();
      toast('Progress loaded from the code.');
    });

    modal.body.append(
      h('h3', { class: 'share-h' }, 'Send your progress'),
      h('p', { class: 'muted share-note' }, 'Your friend needs to import the same Minecraft version from their own jar first (the code holds your rankings, not the pictures).'),
      codeBox, info,
      h('div', { class: 'btn-row left' }, copyBtn, saveBtn),
      h('h3', { class: 'share-h' }, 'Load a code'),
      pasteBox, status,
      h('div', { class: 'btn-row left' }, loadBtn, fileBtn));
  }

  A.openShare = openShare;
  A.editTiers = editTiers;
})();
