// App shell: top bar, category tabs, columns, autosave, image export.
(function () {
  'use strict';
  const { h, toast, popMenu, debounce, confirmDialog } = U;
  const A = App.actions;

  let store = null;
  let tabDrag = null; // id of the category tab being dragged
  let saveState = 'saved'; // saved | saving | error
  let saveError = '';

  // ---- autosave ---------------------------------------------------------
  const doSave = async () => {
    saveState = 'saving';
    paintSaveStatus();
    try {
      const r = await window.api.saveProgress(store.state);
      saveState = r && r.ok ? 'saved' : 'error';
      saveError = r && r.error ? r.error : '';
    } catch (e) {
      saveState = 'error';
      saveError = String(e);
    }
    paintSaveStatus();
  };
  const scheduleSave = debounce(doSave, 500);

  function paintSaveStatus() {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.className = 'save-status ' + saveState;
    el.textContent = saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save failed';
    el.title = saveError;
  }

  // ---- image export -----------------------------------------------------
  A.exportImage = async (nodeId) => {
    nodeId = nodeId || (store.visible()[0] || {}).id;
    const node = store.node(nodeId);
    if (!node) return;
    const LABEL_W = 130;
    const CELL = 64;
    const PAD = 8;
    const WIDTH = 1000;
    const perLine = Math.max(1, Math.floor((WIDTH - LABEL_W - PAD) / CELL));
    const imgIdFor = (key) => key.slice(2);
    const ids = new Set();
    store.allKeys(node).forEach((k) => ids.add(imgIdFor(k)));
    const imgs = new Map();
    await Promise.all([...ids].map((id) => new Promise((resolve) => {
      const it = store.item(id);
      if (!it) return resolve();
      const im = new Image();
      im.onload = () => { imgs.set(id, im); resolve(); };
      im.onerror = () => resolve();
      im.src = Tiers.imgUrl(it);
    })));

    const titleH = 60;
    const heights = node.rows.map((r) => Math.max(76, Math.ceil(r.entries.length / perLine) * CELL + PAD * 2));
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = titleH + heights.reduce((a, b) => a + b, 0) + 6;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#17181c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f2f2f4';
    const mc = document.body.classList.contains('mc-font');
    ctx.font = mc ? '32px MC' : '700 26px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.title, 14, titleH / 2);

    let y = titleH;
    node.rows.forEach((row, ri) => {
      const rh = heights[ri];
      ctx.fillStyle = row.color;
      ctx.fillRect(0, y, LABEL_W, rh);
      ctx.fillStyle = U.contrastText(row.color);
      ctx.font = mc ? '32px MC' : '700 28px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(row.label.slice(0, 8), LABEL_W / 2, y + rh / 2, LABEL_W - 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#23252b';
      ctx.fillRect(LABEL_W, y, WIDTH - LABEL_W, rh);
      row.entries.forEach((key, i) => {
        const x = LABEL_W + PAD + (i % perLine) * CELL;
        const yy = y + PAD + Math.floor(i / perLine) * CELL;
        const im = imgs.get(imgIdFor(key));
        if (im) { ctx.imageSmoothingEnabled = im.naturalWidth > 32; ctx.drawImage(im, x + 6, yy + 6, 40, 40); }
      });
      y += rh;
    });

    const safe = node.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'tier-list';
    const r = await window.api.saveImage(canvas.toDataURL('image/png'), safe + '.png');
    if (r && r.ok) toast('Saved image to ' + r.path);
  };

  // ---- rendering --------------------------------------------------------
  function topbar() {
    const s = store;
    const total = s.activeItems().length, unrated = s.unratedItems().length;
    return h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, 'MC Tier List'),
      h('span', { class: 'muted stat', title: 'Items placed in a category' }, (total - unrated).toLocaleString() + ' / ' + total.toLocaleString() + ' sorted'),
      h('span', { class: 'spacer' }),
      h('span', { id: 'save-status', class: 'save-status ' + saveState, title: saveError }, saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save failed'),
      h('button', { class: 'btn primary', title: 'Shows one random unsorted item at a time to sort with the keyboard (R)', onclick: () => A.sortCard() }, 'Random item'),
      h('button', { class: 'btn', title: 'Copy a code of your progress, or load a friend’s', onclick: () => A.openShare() }, 'Share'),
      h('button', { class: 'btn small', title: 'Undo (Ctrl/Cmd+Z)', disabled: !s.undoStack.length, onclick: () => s.undo() }, 'Undo'),
      h('button', { class: 'btn small', title: 'Redo (Shift+Ctrl/Cmd+Z)', disabled: !s.redoStack.length, onclick: () => s.redo() }, 'Redo'),
      h('button', { class: 'icon-btn', title: 'Menu', onclick: (e) => appMenu(e) }, '⋯'));
  }

  function tabsRow() {
    const s = store, row = h('nav', { class: 'tabs' });
    const cats = s.categories();
    cats.forEach((n) => {
      const todo = s.state.todo, on = todo ? n.tray.length > 0 : (s.state.showAll || s.state.shown.includes(n.id));
      const iconId = s.iconFor(n), it = iconId && s.item(iconId);
      const t = h('button', {
        class: 'mctab' + (on ? ' on' : '') + (n.done ? ' done' : ''), style: { '--c': n.color }, dataset: { cat: n.id },
        title: n.title + (n.done ? ' (done)' : '') + ' · ' + s.countItems(n.id) + ' items' + (n.tray.length ? ', ' + n.tray.length + ' not ranked' : '') + '\nClick to ' + (on ? 'hide' : 'show') + ' · right-click for options · drag to reorder · drop items here',
        onclick: () => { if (s.state.todo) s.showOnly(n.id); else s.toggleShown(n.id); },
      }, h('span', { class: 'mctab-bar' }), it ? Tiers.spriteImg(it, 'mctab-icon') : h('span', { class: 'mctab-icon mctab-q' }, '?'),
        n.done ? h('span', { class: 'mctab-done', title: 'Done' }, '✓') : null,
        null);
      t.draggable = true;
      t.addEventListener('dragstart', (e) => { tabDrag = n.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-mctab', n.id); requestAnimationFrame(() => t.classList.add('tab-dragging')); });
      t.addEventListener('dragend', () => { tabDrag = null; document.querySelectorAll('.tab-ins-before, .tab-ins-after, .tab-dragging').forEach((el) => el.classList.remove('tab-ins-before', 'tab-ins-after', 'tab-dragging')); });
      t.addEventListener('dragover', (e) => {
        if (!tabDrag || tabDrag === n.id) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const r = t.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
        document.querySelectorAll('.tab-ins-before, .tab-ins-after').forEach((el) => el.classList.remove('tab-ins-before', 'tab-ins-after'));
        t.classList.add(after ? 'tab-ins-after' : 'tab-ins-before');
      });
      t.addEventListener('dragleave', (e) => { if (!t.contains(e.relatedTarget)) t.classList.remove('tab-ins-before', 'tab-ins-after'); });
      t.addEventListener('drop', (e) => {
        if (!tabDrag) return;
        e.preventDefault();
        const r = t.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2, order = s.state.order;
        const from = order.indexOf(tabDrag); let to = order.indexOf(n.id) + (after ? 1 : 0); if (from < to) to--;
        const id = tabDrag; tabDrag = null;
        s.moveCategory(id, to);
      });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); A.catMenu(e, n.id); });
      Tiers.wireTarget(t, n.id);
      row.append(t);
    });
    row.append(h('button', { class: 'btn small add-cat', title: 'New category', onclick: () => A.newCategory([], null) }, '+ Category'));
    row.append(h('span', { class: 'spacer' }));
    const all = s.state.showAll;
    const todoN = s.categories().filter((n) => n.tray.length).length, td = s.state.todo;
    row.append(h('button', { class: 'btn small' + (td ? ' primary' : ''), title: 'Show only the categories that still have unranked items in their tray', onclick: () => s.setTodo(!td) }, (td ? '✓ ' : '') + 'Needs sorting (' + todoN + ')'));
    const mg = s.state.merged;
    row.append(h('button', { class: 'btn small' + (mg ? ' primary' : ''), title: 'Combine the shown categories into one tier list (your categories are kept)', onclick: () => s.setMerged(!mg) }, mg ? '✓ Merged' : 'Merge'));
    row.append(h('button', { class: 'btn small' + (all ? ' primary' : ''), title: 'Show every category side by side', onclick: () => s.setShowAll(!all) }, all ? '✓ View all' : 'View all'));
    if (!all && (s.state.shown.length || s.state.todo)) row.append(h('button', { class: 'btn small', onclick: () => { s.state.shown = []; s.state.todo = false; s.emit('view'); } }, 'Hide all'));
    return row;
  }

  function appMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    popMenu(r.right - 220, r.bottom + 4, [
      { label: 'Import items from Minecraft…', onClick: () => A.openImport() },
      { label: 'Undo last import…', onClick: () => A.undoImport() },
      { label: 'Share or load a code…', onClick: () => A.openShare() },
      { label: 'Save first shown category as image…', onClick: () => A.exportImage() },
      '-',
      { label: 'Export progress…', onClick: async () => {
        const res = await window.api.exportProgress(store.state);
        if (res && res.ok) toast('Exported to ' + res.path);
      } },
      { label: 'Restore progress from file…', onClick: async () => {
        const res = await window.api.importProgress();
        if (!res || res.canceled) return;
        if (res.error) { toast(res.error, null, 7000); return; }
        const ok = await confirmDialog({ title: 'Replace current progress?', message: 'Everything you have ranked so far will be replaced by the contents of that file. You can undo this until you quit.', confirmLabel: 'Replace', danger: true });
        if (!ok) return;
        try {
          store.replaceState(Share.sanitize(res.state));
          toast('Progress restored.');
        } catch (e) {
          toast(e.message, null, 7000);
        }
      } },
      { label: 'Install game look from Minecraft…', onClick: () => A.installLook() },
      U.hasClick() ? { label: 'Button click sound: ' + (U.soundPref.on ? 'on' : 'off'), onClick: () => { U.soundPref.on = !U.soundPref.on; } } : null,
      { label: 'Open data folder', onClick: () => window.api.openDataFolder() },
    ].filter(Boolean));
  }

  function render(kind) {
    const root = document.getElementById('app');
    const old = root.querySelector('.cols');
    const sx = old ? old.scrollLeft : 0, sy = old ? old.scrollTop : 0;
    let dock = document.getElementById('dock-root');
    if (!dock) { dock = h('div', { id: 'dock-root' }); }
    const main = h('main', { class: 'main' }, store.state.merged ? Tiers.renderMerged() : Tiers.renderColumns());
    root.replaceChildren(topbar(), tabsRow(), main, dock);
    main.firstChild.scrollLeft = sx; main.firstChild.scrollTop = sy;
    if (kind !== 'view') A.renderDock();
  }

  // ---- rate the selected tiles with a tier letter -----------------------
  // Each item goes to the tier with that letter in ITS OWN category. With one tile selected from a
  // tray, the next tray tile is selected afterwards so you can keep pressing letters.
  function rateSelection(letter) {
    const ids = [...App.sel];
    let moved = 0, nohome = 0, noRow = 0, nextFrom = null;
    if (ids.length === 1) { const hn = store.homeOf(ids[0]); const n = hn && store.node(hn); if (n && n.tray.includes('i:' + ids[0])) nextFrom = n.id; }
    for (const id of ids) {
      const home = store.homeOf(id), n = home && store.node(home);
      if (!n) { nohome++; continue; }
      if (n.done) continue;
      const row = n.rows.find((r) => r.label.trim().charAt(0).toLowerCase() === letter);
      if (!row) { noRow++; continue; }
      if (store.placeItems(n.id, [id], row.id, Infinity)) moved++;
    }
    if (!moved && !nohome && !noRow) return false;
    App.sel.clear();
    if (moved && nextFrom) { const n = store.node(nextFrom); if (n && n.tray.length) { App.sel.add(n.tray[0].slice(2)); } }
    Tiers.paintSel();
    if (App.sel.size) { const el = document.querySelector('[data-item="' + [...App.sel][0] + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
    if (nohome) toast(nohome + ' selected item' + (nohome === 1 ? ' is' : 's are') + ' not in a category yet: drag ' + (nohome === 1 ? 'it' : 'them') + ' onto a tab first.');
    else if (noRow && !moved) toast('No tier starting with “' + letter.toUpperCase() + '” in that category.');
    return true;
  }

  // ---- keyboard ---------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (A.sortCardOpen && A.sortCardOpen()) return;
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.metaKey || e.ctrlKey;
    if (!mod && !e.altKey && !typing && App.sel.size && /^[a-z]$/i.test(e.key) && e.key.toLowerCase() !== 'r' && !document.querySelector('.backdrop')) {
      if (rateSelection(e.key.toLowerCase())) { e.preventDefault(); return; }
    }
    if (mod && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
    } else if (mod && e.key.toLowerCase() === 'a' && !typing) {
      e.preventDefault();
      document.querySelectorAll('.dock-tile').forEach((t) => App.sel.add(t.dataset.item));
      Tiers.paintSel();
    } else if (!mod && !typing && e.key.toLowerCase() === 'r' && !document.querySelector('.backdrop')) {
      e.preventDefault();
      A.sortCard();
    } else if (e.key === 'Escape' && !document.querySelector('.backdrop')) {
      Tiers.clearSel();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (store && saveState !== 'saved') window.api.saveProgress(store.state);
  });

  // ---- boot -------------------------------------------------------------
  async function boot() {
    const looked = U.loadLook();
    const data = await window.api.load();
    store = new Store(data.library);
    App.store = store;
    store.load(data.progress);
    store.on((kind) => {
      render(kind);
      if (kind === 'change' || kind === 'view') scheduleSave();
    });
    render();
    looked.then(() => U.ensureLook(data.library.items.length > 0)).then((r) => {
      if (r.healed) store.emit('view');
      if (r.needJar) toast('The game font, buttons and background need your Minecraft jar.', [{ label: 'Choose jar', onClick: () => A.installLook(true) }], 12000);
    }).catch((e) => console.error(e));
    if (data.recovered) toast('Your progress file was unreadable, so the newest backup was loaded.', null, 9000);
    if (!data.library.items.length) {
      toast('Your item library is empty. Import it from your own copy of Minecraft.', [{ label: 'Import', onClick: () => A.openImport() }], 6000);
    }
  }

  boot().catch((e) => {
    console.error(e);
    document.getElementById('app').textContent = 'Failed to start: ' + e;
  });
})();
