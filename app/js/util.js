window.App = window.App || { store: null, actions: {} };
// Small DOM helpers: element builder, toasts, modals, popup menus, simple dialogs.
(function () {
  'use strict';

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function contrastText(hex) {
    const c = String(hex).replace('#', '');
    const r = parseInt(c.slice(0, 2), 16) || 0;
    const g = parseInt(c.slice(2, 4), 16) || 0;
    const b = parseInt(c.slice(4, 6), 16) || 0;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#15161a' : '#ffffff';
  }

  function debounce(fn, ms) {
    let t = null;
    const wrapped = (...a) => {
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...a); }, ms);
    };
    wrapped.flush = (...a) => {
      if (t) { clearTimeout(t); t = null; fn(...a); }
    };
    return wrapped;
  }

  // ---- toasts -----------------------------------------------------------
  function toast(message, actions, ms) {
    const root = document.getElementById('toast-root');
    const el = h('div', { class: 'toast' }, h('span', null, message));
    const remove = () => el.remove();
    for (const a of actions || []) {
      el.append(h('button', { class: 'toast-btn', onclick: () => { remove(); a.onClick && a.onClick(); } }, a.label));
    }
    root.append(el);
    setTimeout(remove, ms || (actions && actions.length ? 8000 : 4000));
    return remove;
  }

  // ---- popup menu -------------------------------------------------------
  let openMenuEl = null;
  function closeMenu() {
    if (!openMenuEl) return;
    openMenuEl.remove();
    openMenuEl = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onMenuKey, true);
  }
  function onDocDown(e) {
    if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
  }
  function onMenuKey(e) {
    if (e.key === 'Escape' && openMenuEl) { e.stopPropagation(); closeMenu(); }
  }
  function popMenu(x, y, items) {
    closeMenu();
    const m = h('div', { class: 'menu' });
    for (const it of items) {
      if (it === '-') m.append(h('div', { class: 'menu-sep' }));
      else if (it.header) m.append(h('div', { class: 'menu-head' }, it.label));
      else if (it.el) m.append(it.el);
      else {
        m.append(h('button', {
          class: 'menu-item' + (it.danger ? ' danger' : ''),
          disabled: !!it.disabled,
          onclick: () => { closeMenu(); if (it.onClick) it.onClick(); },
        }, it.label));
      }
    }
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
    m.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
    openMenuEl = m;
    setTimeout(() => {
      if (openMenuEl !== m) return; // already closed before the listeners were attached
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onMenuKey, true);
    }, 0);
  }

  // ---- modals -----------------------------------------------------------
  const stack = [];
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
  });

  function openModal(opts) {
    const root = document.getElementById('modal-root');
    const body = h('div', { class: 'modal-body' });
    const api = { body, close: null, el: null };
    const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') + (opts.className ? ' ' + opts.className : '') },
      h('div', { class: 'modal-head' },
        h('h2', null, opts.title || ''),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: () => api.close() }, '✕')),
      body);
    const backdrop = h('div', { class: 'backdrop' }, box);
    let downOnBackdrop = false;
    backdrop.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === backdrop; });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop && downOnBackdrop) api.close(); });
    let closed = false;
    api.close = () => {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      backdrop.remove();
      if (opts.onClose) opts.onClose();
    };
    api.el = backdrop;
    stack.push(api);
    root.append(backdrop);
    return api;
  }

  function confirmDialog({ title, message, confirmLabel, danger }) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (v) => { if (!answered) { answered = true; resolve(v); } };
      const m = openModal({ title: title || 'Are you sure?', onClose: () => done(false) });
      m.body.append(
        h('p', { class: 'dialog-text' }, message),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { done(true); m.close(); } }, confirmLabel || 'OK')));
    });
  }

  function promptDialog({ title, label, value, confirmLabel }) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (v) => { if (!answered) { answered = true; resolve(v); } };
      const m = openModal({ title, onClose: () => done(null) });
      const input = h('input', { type: 'text', class: 'txt', value: value || '', maxlength: '60' });
      const submit = () => {
        const v = input.value.trim();
        if (!v) { input.focus(); return; }
        done(v);
        m.close();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      m.body.append(
        h('label', { class: 'field' }, h('span', null, label), input),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: submit }, confirmLabel || 'Save')));
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  // A dropdown drawn by the app (native <select> menus use the system font, not the game font).
  function select({ value, options, onChange, title, className }) {
    let cur = value;
    const label = () => { const o = options.find((x) => x.value === cur) || options[0]; return o ? o.label : ''; };
    const b = h('button', { class: 'sel select-btn ' + (className || ''), type: 'button', title: title || '' });
    const paint = () => { b.textContent = label() + '  \u25be'; };
    paint();
    b.addEventListener('click', () => {
      const r = b.getBoundingClientRect();
      popMenu(r.left, r.bottom + 2, options.map((o) => ({ label: (o.value === cur ? '\u2713 ' : '') + o.label, onClick: () => { cur = o.value; paint(); if (onChange) onChange(o.value); } })));
    });
    return b;
  }

  // Hover tips drawn by the app in the game's tooltip style: native title tooltips use the system font.
  (function tooltips() {
    let tip = null, timer = 0, host = null, mx = 0, my = 0;
    const hide = () => { clearTimeout(timer); timer = 0; if (tip) { tip.remove(); tip = null; } host = null; };
    const show = () => {
      if (!host || !host.isConnected) return;
      const text = host.dataset.tip; if (!text) return;
      tip = h('div', { class: 'mc-tip' }, text); document.body.append(tip);
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.max(4, Math.min(mx + 14, window.innerWidth - r.width - 4)) + 'px';
      tip.style.top = Math.max(4, Math.min(my + 18, window.innerHeight - r.height - 4)) + 'px';
    };
    document.addEventListener('mouseover', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[title],[data-tip]') : null;
      if (el === host) return;
      hide();
      if (!el) return;
      if (el.hasAttribute('title')) { const t = el.getAttribute('title'); el.removeAttribute('title'); if (t) el.dataset.tip = t; }
      if (!el.dataset.tip) return;
      host = el; mx = e.clientX; my = e.clientY; timer = setTimeout(show, 350);
    }, true);
    document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; }, true);
    ['mousedown', 'dragstart', 'wheel', 'keydown', 'contextmenu'].forEach((t) => document.addEventListener(t, hide, true));
    document.addEventListener('mouseout', (e) => { if (host && !host.contains(e.relatedTarget)) hide(); }, true);
  })();

  // The game's look lives in <data>/ui, generated from the player's own jar: pixel font, tab sprites,
  // menu background, button sprites and the button click sound. Each part switches on its own body class.
  const uiUrl = (f, t) => 'url("app://local/ui/' + f + '?v=' + t + '")';
  async function loadUiFont() {
    try {
      const r = await fetch('app://local/ui/mc.ttf?v=' + Date.now());
      if (!r.ok) return false;
      const ff = new FontFace('MC', await r.arrayBuffer());
      await ff.load(); document.fonts.add(ff);
      document.body.classList.add('mc-font');
      return true;
    } catch (e) { return false; }
  }
  function loadUiBg(st, t) {
    const on = !!(st && st.bg);
    if (on) document.documentElement.style.setProperty('--dirt', uiUrl('bg.png', t));
    document.body.classList.toggle('mc-bg', on);
    return on;
  }
  function loadUiButtons(st, t) {
    const on = !!(st && st.buttons), root = document.documentElement.style;
    if (on) {
      root.setProperty('--btn', uiUrl('btn.png', t)); root.setProperty('--btn-hi', uiUrl('btn_hi.png', t));
      root.setProperty('--btn-off', uiUrl(st.missing && st.missing.includes('btn_off.png') ? 'btn.png' : 'btn_off.png', t));
      root.setProperty('--btn-s', String(st.border || 3)); root.setProperty('--btn-b', (st.border || 3) * 2 + 'px');
    }
    document.body.classList.toggle('mc-btn', on);
    return on;
  }

  // Button click sound (the game's own, copied from the player's install). Decoded once, played through Web Audio.
  let actx = null, clickBuf = null;
  const soundPref = { get on() { try { return localStorage.getItem('mctl.sound') !== '0'; } catch (e) { return true; } }, set on(v) { try { localStorage.setItem('mctl.sound', v ? '1' : '0'); } catch (e) { /* ignore */ } } };
  async function loadClick(st) {
    clickBuf = null;
    if (!st || !st.sound) return false;
    try {
      const r = await fetch('app://local/ui/click.ogg?v=' + Date.now());
      if (!r.ok) return false;
      actx = actx || new AudioContext();
      clickBuf = await actx.decodeAudioData(await r.arrayBuffer());
      return true;
    } catch (e) { clickBuf = null; return false; }
  }
  function playClick() {
    if (!clickBuf || !actx || !soundPref.on) return;
    try {
      if (actx.state === 'suspended') actx.resume();
      const src = actx.createBufferSource(), gain = actx.createGain();
      gain.gain.value = 0.25; src.buffer = clickBuf; src.connect(gain); gain.connect(actx.destination); src.start();
    } catch (e) { /* silent */ }
  }
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('mc-btn')) return;
    const b = e.target && e.target.closest ? e.target.closest('.btn, .toast-btn, .select-btn') : null;
    if (b && !b.disabled) playClick();
  }, true);

  async function applyLook(st) {
    const t = Date.now();
    if (st && st.font) await loadUiFont();
    // Versioned URLs so sprites rebuilt while the app is open replace the ones already shown.
    const fr = !!(st && st.frame);
    if (fr) { document.documentElement.style.setProperty('--frame', uiUrl('frame.png', t)); document.documentElement.style.setProperty('--frame-hi', uiUrl('frame_hi.png', t)); }
    document.body.classList.toggle('mc-frame', fr);
    if (st && st.tabs) { const root = document.documentElement.style; root.setProperty('--tab-off', uiUrl('tab_off.png', t)); root.setProperty('--tab-sel', uiUrl('tab_sel.png', t)); }
    loadUiBg(st, t); loadUiButtons(st, t); await loadClick(st);
    return st;
  }
  // Applies whatever look is already in <data>/ui.
  async function loadLook() { try { return await applyLook(await window.api.uiStatus()); } catch (e) { return null; } }
  // Self-heal: if parts of the look are missing or from an older version (data folder copied from another install,
  // or made by an older app version), rebuild them from the installed jar. Returns { status, healed, needJar }.
  async function ensureLook(hasItems) {
    let st = await window.api.uiStatus(), healed = false, needJar = false;
    if (!st.complete && hasItems) {
      let file = null;
      try { const inst = await window.api.jarInstalled(); file = (inst.jars.find((j) => j.version === inst.current) || inst.jars[0] || {}).path || null; } catch (e) { /* none */ }
      if (file) { const r = await window.api.uiBuild(file); if (r && r.ok) { healed = true; st = await window.api.uiStatus(); } else needJar = true; }
      else needJar = true;
    }
    await applyLook(st);
    return { status: st, healed, needJar };
  }

  window.U = { select, loadUiFont, loadUiBg, loadLook, ensureLook, soundPref, hasClick: () => !!clickBuf, h, contrastText, debounce, toast, popMenu, closeMenu, openModal, confirmDialog, promptDialog };
})();
