'use strict';
// Pure Node helpers (no Electron) so they can be tested on their own.

const SMALL_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'to', 'a', 'with']);

const NAME_OVERRIDES = {
  tnt_minecart: 'Minecart with TNT',
  chest_minecart: 'Minecart with Chest',
  furnace_minecart: 'Minecart with Furnace',
  hopper_minecart: 'Minecart with Hopper',
  command_block_minecart: 'Minecart with Command Block',
  writable_book: 'Book and Quill',
  filled_map: 'Map',
  map: 'Empty Map',
  experience_bottle: "Bottle o' Enchanting",
  ender_eye: 'Eye of Ender',
  carrot_on_a_stick: 'Carrot on a Stick',
  warped_fungus_on_a_stick: 'Warped Fungus on a Stick',
};

function makeName(id) {
  if (NAME_OVERRIDES[id]) return NAME_OVERRIDES[id];
  return id
    .split('_')
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// ---- save-format migrations ----
const emptyLibrary = () => ({ schema: 2, rev: 1, version: '', versionInfo: null, items: [], history: [] });

function migrateLibrary(lib) {
  if (!lib || typeof lib !== 'object' || !Array.isArray(lib.items)) return emptyLibrary();
  const out = Object.assign(emptyLibrary(), lib, { schema: 2 });
  out.items = lib.items.filter((i) => i && typeof i.id === 'string' && i.id).map((i) => Object.assign({}, i, {
    name: i.name || makeName(i.id), img: i.img || i.id + '.png', tags: Array.isArray(i.tags) ? i.tags : [],
  }));
  if (!Array.isArray(out.history)) out.history = [];
  return out;
}

module.exports = { makeName, emptyLibrary, migrateLibrary };
