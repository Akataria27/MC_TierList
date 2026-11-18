MC TIER LIST  -  offline Minecraft item tier list
==================================================

RUNNING IT (macOS)
  1. Install Node.js (LTS) from https://nodejs.org  - one time.
  2. Double-click  start-mac.command
     * First launch downloads Electron into this folder (needs internet ONCE).
       After that it never touches the network.
     * macOS may say the file is from an unidentified developer. Right-click it,
       choose Open, then Open again. If it still refuses, run this once in Terminal:
           xattr -dr com.apple.quarantine /path/to/mc-tierlist

RUNNING IT (Windows)
  1. Install Node.js (LTS) from https://nodejs.org  - one time.
  2. Extract the whole zip first (right-click > Extract All). Do not run it from inside the zip.
  3. Double-click  start-windows.bat
     * First launch downloads Electron into this folder (needs internet ONCE).
     * If Windows SmartScreen appears: More info > Run anyway.
     * Your Minecraft jars are in  %APPDATA%\.minecraft\versions  (paste that into a file dialog).

HOW IT WORKS  (version 0.3: columns)
  Categories are TABS under the top bar. Click a tab to show or hide that
  category's column; "View all" shows every column side by side. Each column has
  a "Not ranked yet" tray and its own tier rows (S-F by default; edit them from
  the column's ... menu > Edit tiers). Right-click a tab for the same menu.

  "Needs sorting (N)" shows only the categories that still have items in their "Not ranked
  yet" tray (the tabs of those carry an orange count). Click a tab to jump to one category.

  "Merge" (next to View all) combines the shown categories into one list: tiers with
  the same label are joined, and each item keeps its category colour as a border.
  In Merged view you can drag an item to another tier: it moves to the same-named tier of
  its own category. It is only a view - your categories are untouched; click Merge again to go back.

  The DOCK along the bottom holds every item you haven't sorted yet.
    * Click an item to select it; Shift-click selects a range, Cmd/Ctrl-click
      toggles, "Select all shown" (or Cmd/Ctrl+A) takes everything that matches the
      filter. Filter by name, #tag, or the tag drop-down.
    * Drag the selection onto a TAB or column header (it lands in that category's
      tray), or straight onto a tier row. Drag ranked items between tiers and
      columns, or back onto the dock to un-rank them.
    * Drag the thin bar on the dock's top edge to make it taller or shorter (double-click
      resets), and use the slider in its toolbar to change item size. Both are remembered.
    * Pick a tag, then "Category from this tag" makes a category pre-filled with
      all matching unsorted items. "Category from selection" does the same for
      what you have selected. Right-click any item for more (move to...).

  Rate with the keyboard: click tiles (e.g. in a category's "Not ranked yet" tray) and press
  S/A/B/C/D/F - each tile goes to that tier of its own category. With one tile
  selected, the next tray tile is selected for you, so you can just keep pressing letters.

  Random item (button, or press R; called "Sort cards" before 0.4.5) shows one random unsorted item at a time:
      1-9   the categories YOU pinned to number keys (✕ frees a number, "+ number" on a
            list row assigns the lowest free one; saved with your progress). Until you
            change them it is the first nine tabs. Every other category is in the
            scrollable list below - just click it. A star marks the best tag match.
      /     filter that list by name
      S A B C D F   place it in that tier. Pressing a letter with no category chosen uses
            the starred best match, so one key sorts an item.
      -     put it in the category's tray unranked      N   "Not sure" category
      Space skip      Cmd/Ctrl+Z undo the last one      Esc close
  Done: from the ... menu a category can be marked Done. It locks (nothing moves
  in or out) so later imports can't disturb it.
  Undo / Redo   toolbar buttons, or Cmd+Z / Shift+Cmd+Z.
  Save as image exports a category as a PNG (its ... menu).

SAVING
  Automatic. A moment after every change your rankings are written to
  data/progress.json (the "Saved" badge at the top right confirms it), so you can
  quit any time. Backups: see below.

SHARING PROGRESS WITH A FRIEND (the Share button)
  Share > Copy code gives one block of text (about 11,000 characters for 1,500
  ranked items) that contains your whole list: categories, tiers and
  every placement. Your friend pastes it under "Load a code" and their list
  becomes identical to yours.
  * Your friend must import the same Minecraft version from their own jar first.
    The code carries rankings, not pictures. Items they don't have yet show as "?"
    tiles and fill in once they import them.
  * Loading REPLACES the friend's current progress. A backup is saved first and
    Undo works until the app is quit.
  * Chat apps sometimes cut long messages: use "Save code as file" and send the
    .txt, and the friend uses "Load code from file". A damaged or incomplete
    code is detected and refused.
  * There are no short codes: the app is offline, so the code IS the data.

YOUR DATA (all inside this folder, in data/)
  library.json    the item list (id, name, image, version added, tags)
  items/          the icons drawn from your jar
  snapshots/      pre-import copies used by Undo last import
  progress.json   your rankings; autosaved a moment after every change
  backups/        automatic copies of progress.json (every 30 min of use, newest 30 kept)
  Copy the whole folder (without node_modules) to move everything to another computer.
  Menu > Export progress / Restore progress from file make a portable copy.

LOADING THE ITEMS FROM YOUR OWN MINECRAFT  (version 0.2)
  The app ships EMPTY: no Minecraft art is included. Items are read from the game
  jar on your own computer.
  Menu (the three dots) > Import items from Minecraft...
    * Installed launcher versions are found automatically (macOS
      ~/Library/Application Support/minecraft/versions, Windows
      %APPDATA%\.minecraft\versions, Linux ~/.minecraft/versions). Or choose any
      client jar with "Choose a jar file...". Run the game version once in the
      launcher first so its jar is downloaded.
    * Needs Minecraft 1.21.4 or newer (item definitions). Older or unrelated jars
      are refused with a clear message.
    * ~1,800 icons are drawn in a few seconds: flat items use their sprite at
      native size; blocks and chests, banners, heads, shields etc. are drawn as
      64x64 icons the way the inventory shows them. Also generated: potions,
      splash, lingering, tipped arrows (25 each) and one Enchanted Book per
      enchantment (max level). Names come from the game's own English text.
    * Any item that can't be drawn gets a magenta/black placeholder icon and is
      listed in the import summary; the rest of the import is never affected.
  Share codes carry rankings only. Friends import their own jar.

TAGS
  Every item carries the game's item tags (#minecraft:planks ...). Right-click an
  item (on a tile or in the Unrated grid) to see them all. The Unrated browser has a
  tag filter (very broad/tiny tags hidden unless "all tags" is ticked); typing
  "#planks" in the search box also matches tags. Category tiles don't show tags.

DONE CATEGORIES
  Category tile menu or List options > Mark as done. A done category shows a green
  check on its tile, is locked (no moving, adding, removing, cover or tier edits,
  no delete) and is not offered when placing items. Sub-categories inside it are
  locked too. Reopen it from the same menu. Done marks travel in share codes.
  New game items that look like they belong in a done category are flagged
  (check badge in the Unrated grid, "Fits a finished list" filter, banner inside).

UPDATING TO A NEW MINECRAFT VERSION
  Import again with the new jar. The app compares it with your library:
    * new items get a NEW badge and a "New in 26.x" filter chip until you rate
      them (or press "Clear new flags")
    * removed items stay, marked "removed in 26.x", and are no longer offered
    * items renamed by the game (same icon, new id) are detected and your ranking
      moves with them (you confirm first)
    * re-importing the same version just refreshes icons, names and tags
  Before every import a snapshot is kept (data/snapshots, last 10).
  Menu > Undo last import restores the previous library; items that import added
  and that you ranked since are un-ranked (you are warned first).



NEW IN 0.4.0
- Game look: the whole program uses Minecraft's own pixel font. It is built from YOUR copy of the game when you import
  (nothing from Minecraft is bundled). If you imported before, use the ... menu > "Install game font and tabs from Minecraft...".
- Category tabs are now creative-inventory style icon tabs. Pick the item shown on a tab with right-click > "Tab icon..."
  (or the category's ... menu). Hover a tab for the category name and counts. Click toggles its column; drop items on it to add them.
  A small number on a tab is how many items are not ranked yet; a check mark means Done.
- Merged view just says "Merged" (the category names are gone; items keep their category-coloured border).
- Tier rows wrap and grow taller instead of scrolling sideways.

NEW IN 0.4.1
- Drag the tabs along the top to reorder categories. The order is saved automatically (columns follow it too).
- The yellow unsorted-count bubbles on tabs are gone (the "Needs sorting (N)" button still shows the count; hover a tab for its numbers).
- The game font is now used for all text the app draws: dropdowns and hover tips are drawn by the app instead of the system.
  (Only the window title bar and system file dialogs stay in the system font.)

0.4.2
- Background is now the game's menu dirt (block/dirt.png from your jar at 25% brightness, tiled 2x pixelated), with dark translucent panels on top. Extracted at import / "Install game font and tabs from Minecraft...". Nothing from Mojang is bundled.

0.4.3
- The game look repairs itself. At start, if the font, tabs, background or buttons are missing from data/ui (for example the data
  folder was copied from another computer or made by an older version), they are rebuilt from your installed Minecraft jar.
  If no installed jar is found, a message offers "Choose jar".
- The background no longer depends on the font being installed, and the panels on top of it are more transparent.

0.4.4
- Background is now the game's real menu background texture (gui/menu_background.png from your jar), not the dirt block.
  It is drawn at the game's size (GUI scale 2), unsmoothed. Jars from before that texture existed fall back to the old
  darkened options background / dirt.
- Buttons are drawn with the game's own button sprites and behave like the options menu: the white outline appears instantly
  on hover or keyboard focus, disabled buttons use the dark sprite with grey text, and clicking plays the game's click sound.
  Active toggles (Merged, View all, Needs sorting) and the main action of a dialog use yellow text.
- The click sound is copied from your Minecraft install (assets folder), so it only works when the jar is in the launcher's
  normal versions folder or Minecraft is installed in the default place. Turn it off in the ... menu > "Button click sound".
- The ... menu entry is now "Install game look from Minecraft..." (font, tabs, background, buttons, sound).
- Windows instructions added above. A .gitignore is included so the project can go on GitHub without node_modules or any
  game-derived files (the data folder is never uploaded).

0.4.5
- Buttons and the creative-style tabs are darker so they match the dark theme (button sprites at 65% brightness, tab sprites
  at 55%; the white hover outline stays white). Existing installs rebuild the look by themselves on the next start.
- The "Sort cards" button is now "Random item" (same feature, same R shortcut).

0.4.6
- Every item now sits in a Minecraft item frame (the game's own item-frame picture, taken from your jar) at 60% opacity and
  full brightness. The frame brightens a little under the mouse.
- Buttons are a bit lighter (80% of the game's brightness, was 65%). Tabs stay at 55%.
- Existing installs pick this up by themselves on the next start (the game look is rebuilt from your jar).

0.4.7
- The item frames now look like a frame placed on a wall (birch-plank border around the leather back, built from the
  item frame's block model and textures in your jar) instead of the item frame's inventory picture.
- As in the game, the item fills the middle two-thirds of the frame. Item tiles in the columns are a little bigger
  (48px instead of 44px) so the frame's pixels stay even.
