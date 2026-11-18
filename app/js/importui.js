// Import dialog: reads items from the player's own Minecraft jar, shows what changed, applies or undoes it.
(function () {
  'use strict';
  const { h, toast, openModal, confirmDialog } = U;
  const A = window.App.actions;

  const REL_TEXT = {
    first: 'First import: your library will be filled from this jar.',
    same: 'Same version as your library. Icons, names and tags are refreshed; nothing is marked new.',
    newer: 'Newer than your library. New items get a NEW badge and removed items are kept and marked.',
    older: 'Older than your library. Items that are not in this version would be marked as removed.',
  };

  async function openImport() {
    const store = App.store;
    let busy = false, closed = false;
    const modal = openModal({ title: 'Import items from Minecraft', wide: true, onClose: () => { closed = true; if (busy) window.api.jarCancel(); } });
    const body = modal.body;
    const show = (...nodes) => body.replaceChildren(...nodes.filter(Boolean));

    // ---- step 1: choose a jar
    const inst = await window.api.jarInstalled();
    const cur = store.library.version;
    const pickRow = (j) => h('button', { class: 'jar-row', onclick: () => inspect(j.path) },
      h('strong', null, 'Minecraft ' + j.version),
      j.version === cur ? h('span', { class: 'tag' }, 'in your library') : null,
      h('span', { class: 'muted mono jar-path' }, j.path));

    function chooser(errorText) {
      show(
        h('p', { class: 'dialog-text' }, 'Pick the Minecraft version to read items from. Everything is taken from your own copy of the game, so nothing from Minecraft is bundled with this app or shared in tier list codes.'),
        errorText ? h('div', { class: 'code-status bad' }, errorText) : null,
        inst.jars.length ? h('div', { class: 'jar-list' }, h('div', { class: 'muted' }, 'Found on this computer'), ...inst.jars.map(pickRow))
          : h('div', { class: 'muted pad' }, 'No Minecraft launcher versions were found automatically. Choose the jar file yourself (it lives in the “versions” folder of your Minecraft folder, e.g. versions/26.3/26.3.jar).'),
        h('div', { class: 'btn-row left' },
          h('button', { class: 'btn', onclick: async () => { const r = await window.api.jarPick(); if (r && r.path) inspect(r.path); } }, 'Choose a jar file…'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel')));
    }

    // ---- step 2: validate and preview
    async function inspect(file) {
      show(h('div', { class: 'muted pad' }, 'Checking that jar…'));
      const r = await window.api.jarInspect(file);
      if (closed) return;
      if (r.error) { chooser(r.error); return; }
      const older = r.relation === 'older';
      const ack = h('input', { type: 'checkbox' });
      const go = h('button', { class: 'btn primary', disabled: older, onclick: () => build(file) }, 'Import ' + r.itemCount.toLocaleString() + ' items');
      ack.addEventListener('change', () => { go.disabled = !ack.checked; });
      show(
        h('h3', { class: 'share-h' }, 'Minecraft ' + r.version.name),
        h('p', { class: 'dialog-text' }, r.itemCount.toLocaleString() + ' items found, plus potions, tipped arrows and enchanted books. ' + REL_TEXT[r.relation]),
        older ? h('div', { class: 'code-status bad' }, 'Your library is on ' + r.current + ', which is newer than this jar. You can still import it (and undo afterwards), but newer items will be marked removed.') : null,
        older ? h('label', { class: 'check' }, ack, h('span', null, 'I understand, import the older version anyway')) : null,
        h('p', { class: 'muted' }, 'Drawing every icon takes a few seconds. Your rankings are saved first.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => chooser() }, 'Back'), go));
    }

    // ---- step 3: progress
    async function build(file) {
      busy = true;
      const fill = h('div', { class: 'bar-fill' }), label = h('div', { class: 'muted' }, 'Starting…');
      show(h('p', { class: 'dialog-text' }, 'Reading your Minecraft jar and drawing every icon…'), h('div', { class: 'bar' }, fill), label);
      window.api.onJarProgress((p) => {
        fill.style.width = (p.total ? Math.round(p.done / p.total * 100) : 0) + '%';
        label.textContent = p.done.toLocaleString() + ' / ' + p.total.toLocaleString() + (p.name ? ' · ' + p.name : '');
      });
      const r = await window.api.jarBuild(file);
      busy = false;
      if (closed) return;
      if (r.error) { chooser('The import failed: ' + r.error); return; }
      review(r.plan);
    }

    // ---- step 4: review the changes
    function review(plan) {
      const picks = plan.renames.map((x) => ({ x, box: h('input', { type: 'checkbox', checked: true }) }));
      const list = (arr, n) => arr.slice(0, n).map((i) => i.name).join(', ') + (arr.length > n ? ' … and ' + (arr.length - n) + ' more' : '');
      const first = plan.relation === 'first';
      const apply = h('button', { class: 'btn primary', onclick: () => commit(picks.filter((p) => p.box.checked).map((p) => ({ from: p.x.from, to: p.x.to }))) }, 'Apply import');
      show(
        h('h3', { class: 'share-h' }, first ? 'Ready to fill your library' : 'What changed'),
        h('ul', { class: 'sum-list' },
          first ? h('li', null, plan.added.length.toLocaleString() + ' items. The placeholder sprites are replaced.') : null,
          !first && plan.added.length ? h('li', null, h('strong', null, plan.added.length + ' new'), ' (' + (plan.relation === 'same' ? 'not flagged' : 'flagged NEW') + '): ' + list(plan.added, 12)) : null,
          !first && plan.removed.length ? h('li', null, h('strong', null, plan.removed.length + ' removed'), ' (kept and marked, never offered for rating): ' + list(plan.removed, 12)) : null,
          plan.returned ? h('li', null, plan.returned + ' previously removed item' + (plan.returned === 1 ? ' is' : 's are') + ' back.') : null,
          !first && !plan.added.length && !plan.removed.length ? h('li', null, 'No items added or removed. Icons, names and tags are refreshed.') : null),
        picks.length ? h('div', { class: 'rename-box' },
          h('strong', null, 'Looks like these items were renamed'),
          h('div', { class: 'muted' }, 'Same icon, different id. Keep your ranking by treating them as a rename.'),
          ...picks.map((p) => h('label', { class: 'check' }, p.box, h('span', null, p.x.fromName + '  →  ' + p.x.toName)))) : null,
        plan.failed.length ? h('details', { class: 'fail-box' }, h('summary', null, plan.failed.length + ' item' + (plan.failed.length === 1 ? '' : 's') + ' couldn’t be drawn and use a labelled placeholder icon'),
          ...plan.failed.map((f) => h('div', { class: 'muted mono' }, f.id + ': ' + f.error))) : null,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => { window.api.jarCancel(); modal.close(); } }, 'Cancel'), apply));
    }

    // ---- step 5: apply
    async function commit(renames) {
      show(h('div', { class: 'muted pad' }, 'Applying…'));
      try { await window.api.saveProgress(store.state); } catch (e) { /* the main process backs up as well */ }
      const r = await window.api.jarCommit({ renames });
      if (r.error) { chooser('Could not apply the import: ' + r.error); return; }
      store.setLibrary(r.library);
      const look = r.look && r.look.ok ? !!(await U.loadLook()) : false;
      const map = {}; r.renames.forEach((x) => { map[x.from] = x.to; });
      if (r.renames.length) store.renameItems(map);
      if (r.purge.length) store.purgeItems(r.purge);
      store.clearHistory();
      store.emit('change');
      const s = r.summary;
      show(
        h('h3', { class: 'share-h' }, '✓ Imported Minecraft ' + s.version),
        h('p', { class: 'dialog-text' }, store.library.items.length.toLocaleString() + ' items in your library'
          + (s.added && s.relation !== 'first' ? ' · ' + s.added + ' new' : '') + (s.removed ? ' · ' + s.removed + ' removed' : '') + (s.renamed ? ' · ' + s.renamed + ' renamed' : '') + '.'),
        s.failed.length ? h('div', { class: 'code-status bad' }, s.failed.length + ' item(s) use a placeholder icon: ' + s.failed.map((f) => f.id).join(', ')) : null,
        look ? h('p', { class: 'muted' }, 'The game’s pixel font and tab style were taken from the same jar.') : h('div', { class: 'code-status bad' }, 'The game font and tab style could not be read from this jar' + (r.look && r.look.error ? ' (' + r.look.error + ')' : '') + '. The app keeps its normal look.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => modal.close() }, 'Done'),
          h('button', { class: 'btn primary', onclick: () => { modal.close(); A.renderDock && A.renderDock(); } }, 'Close')));
    }

    chooser();
  }

  async function undoImport() {
    const store = App.store;
    const info = await window.api.jarUndoInfo();
    if (!info.ok) { toast('There is no import to undo.'); return; }
    const m = info.meta, rated = store.ratedAmong(m.addedIds || []);
    const lines = ['Go back to the library you had before importing ' + m.to + (m.from ? ' (' + m.from + ')' : '') + '.'];
    if (m.renames && m.renames.length) lines.push(m.renames.length + ' renamed item' + (m.renames.length === 1 ? '' : 's') + ' go back to their old ids.');
    if ((m.addedIds || []).length) lines.push(m.addedIds.length + ' items added by that import disappear' + (rated ? ', and ' + rated + ' of them you have already ranked are un-ranked' : '') + '.');
    if (m.purge && m.purge.length) lines.push('Placeholder sprites return, but rankings of placeholders that were replaced are not restored (a backup of your progress was saved).');
    const ok = await confirmDialog({ title: 'Undo the last import?', message: lines.join(' '), confirmLabel: 'Undo import', danger: true });
    if (!ok) return;
    try { await window.api.saveProgress(store.state); } catch (e) { /* ignore */ }
    const r = await window.api.jarUndo();
    if (r.error) { toast(r.error, null, 7000); return; }
    store.setLibrary(r.library);
    const inv = {}; (m.renames || []).forEach((x) => { inv[x.to] = x.from; });
    if (Object.keys(inv).length) store.renameItems(inv);
    if ((m.addedIds || []).length) store.purgeItems(m.addedIds);
    store.clearHistory();
    store.emit('change');
    toast('Import undone. Back to ' + (r.library.version || 'the previous library') + '.');
  }

  // Reads only the game look (font, tabs, background, buttons, click sound) from a jar. pick=true always asks for the file.
  async function installLook(pick) {
    let file = null;
    if (!pick) { const inst = await window.api.jarInstalled(); file = (inst.jars.find((j) => j.version === inst.current) || inst.jars[0] || {}).path; }
    if (!file) { const r = await window.api.jarPick(); if (!r || !r.path) return; file = r.path; }
    const r = await window.api.uiBuild(file);
    if (r.error || !r.ok) { toast('Could not read the game look: ' + (r.error || 'unknown error'), null, 7000); return; }
    await U.loadLook();
    toast('Game look installed' + (r.sound ? '.' : ' (no click sound: Minecraft’s sound files were not found next to this jar).'));
    App.store.emit('view');
  }
  A.installLook = installLook;
  A.openImport = openImport;
  A.undoImport = undoImport;
})();
