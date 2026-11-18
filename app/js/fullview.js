'use strict';
// Full-screen view of the tier list (read-only). Opens on "Board": every shown category merged into one S..F list,
// sized so it all fits on screen. "Categories" switches to one small tier list per category.
// Which categories: View all = every category; otherwise the categories currently open (none open = every category).
(() => {
  const A = window.App.actions;
  const { h } = U;
  let root = null, mode = 'board', fitTimer = 0, unsub = null, scrolls = [];

  function cats() {
    const s = App.store;
    const shown = s.state.showAll ? [] : s.categories().filter((n) => s.state.shown.includes(n.id));
    return { list: shown.length ? shown : s.categories(), all: !shown.length };
  }
  const items = (keys) => keys.map((k) => App.store.itemMap.get(k.slice(2))).filter(Boolean);

  function tile(it, catColor) {
    const t = h('div', { class: 'fv-tile', title: it.name }, Tiers.spriteImg(it));
    if (catColor) t.style.setProperty('--cat', catColor);
    return t;
  }
  function label(text, color) {
    const d = h('div', { class: 'fv-label' }, text);
    d.style.background = color; d.style.color = U.contrastText(color);
    return d;
  }
  // Tier names in the order they first appear, with the first colour seen for each.
  function tierLabels(list) {
    const order = [], color = {};
    for (const c of list) for (const r of c.rows) { if (!(r.label in color)) { order.push(r.label); color[r.label] = r.color; } }
    return { order, color };
  }

  function renderBoard(body, list) {
    const { order, color } = tierLabels(list);
    let n = 0;
    for (const l of order) {
      const its = list.flatMap((c) => items((c.rows.find((r) => r.label === l) || { entries: [] }).entries));
      if (!its.length) continue;
      n += its.length;
      body.append(h('div', { class: 'fv-row' }, label(l, color[l]), h('div', { class: 'fv-wrap' }, ...its.map((it) => tile(it)))));
    }
    if (!n) body.append(h('div', { class: 'fv-empty' }, 'Nothing ranked in these categories yet.'));
    return n;
  }
  function renderCards(body, list) {
    let n = 0;
    for (const c of list) {
      const rows = c.rows.filter((r) => r.entries.length);
      if (!rows.length) continue;
      const iconId = App.store.iconFor(c), icon = iconId && App.store.item(iconId); // same icon as the category's tab
      const card = h('div', { class: 'fv-card' }, h('div', { class: 'fv-card-head' }, icon ? Tiers.spriteImg(icon, 'fv-cat-icon') : null, h('span', null, c.title)));
      for (const r of rows) { n += r.entries.length; card.append(h('div', { class: 'fv-row' }, label(r.label, r.color), h('div', { class: 'fv-wrap' }, ...items(r.entries).map((it) => tile(it))))); }
      body.append(card);
    }
    if (!n) body.append(h('div', { class: 'fv-empty' }, 'Nothing ranked in these categories yet.'));
    return n;
  }

  // Board: biggest tile size (64px down to 16px) at which everything fits without scrolling.
  function fit() {
    if (!root || mode !== 'board') return;
    const body = root.querySelector('.fv-body');
    let s = 64; root.style.setProperty('--fv', s + 'px');
    while (s > 16 && body.scrollHeight > body.clientHeight) { s -= 1; root.style.setProperty('--fv', s + 'px'); }
  }
  const refit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 60); };

  function render() {
    if (!root) return;
    const { list, all } = cats();
    root.classList.toggle('fv-board', mode === 'board'); root.classList.toggle('fv-cards', mode === 'cards');
    const body = h('div', { class: 'fv-body' });
    const n = mode === 'board' ? renderBoard(body, list) : renderCards(body, list);
    const what = all ? 'All categories' : list.length === 1 ? list[0].title : list.length + ' categories';
    const seg = (m, text) => h('button', { class: 'btn' + (mode === m ? ' primary' : ''), onclick: () => { if (mode !== m) { mode = m; render(); } } }, (mode === m ? '✓ ' : '') + text);
    root.replaceChildren(
      h('div', { class: 'fv-head' },
        h('div', { class: 'fv-title' }, what),
        h('div', { class: 'fv-sub' }, n + ' ranked item' + (n === 1 ? '' : 's')),
        h('div', { class: 'fv-sp' }),
        seg('board', 'Board'), seg('cards', 'Categories'),
        h('button', { class: 'btn', title: 'Esc or F11', onclick: close }, 'Exit full screen')),
      body);
    if (mode === 'board') { root.style.setProperty('--fv', '64px'); requestAnimationFrame(fit); }
  }

  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    // Keep the main window's shortcuts (rating, R, undo...) from acting behind the full-screen view.
    e.stopPropagation();
  }
  function onFsChange() { if (root && !document.fullscreenElement) close(true); }

  function open() {
    if (root) return;
    mode = 'board';
    U.closeMenu && U.closeMenu();
    // Its own page: the main screen is taken out of the display entirely (body.fv-open), not just covered,
    // so nothing of it can show through. Scroll positions are put back on close.
    scrolls = [...document.querySelectorAll('#app *')].filter((e) => e.scrollTop || e.scrollLeft).map((e) => [e, e.scrollTop, e.scrollLeft]);
    root = h('div', { class: 'fullview' });
    document.body.append(root);
    document.body.classList.add('fv-open');
    render();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', refit);
    unsub = App.store.on ? App.store.on(() => render()) : null;
    document.documentElement.requestFullscreen().catch(() => { /* stays as a full-window view */ });
  }
  function close(fromFs) {
    if (!root) return;
    root.remove(); root = null;
    document.body.classList.remove('fv-open');
    for (const [e, t, l] of scrolls) { e.scrollTop = t; e.scrollLeft = l; }
    scrolls = [];
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', refit);
    if (typeof unsub === 'function') unsub();
    unsub = null;
    if (!fromFs && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  document.addEventListener('fullscreenchange', onFsChange);
  window.api.onToggleFullView && window.api.onToggleFullView(() => (root ? close() : open()));

  A.fullView = open;
  A.fullViewOpen = () => !!root;
})();
