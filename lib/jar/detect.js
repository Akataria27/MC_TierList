'use strict';
// Finds Minecraft client jars installed by the official launcher (and compatible launchers).
const fs = require('fs');
const path = require('path');
const os = require('os');

function versionDirs() {
  const home = os.homedir(), out = [];
  if (process.platform === 'darwin') out.push(path.join(home, 'Library/Application Support/minecraft/versions'));
  else if (process.platform === 'win32') out.push(path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), '.minecraft/versions'));
  else out.push(path.join(home, '.minecraft/versions'));
  if (process.env.MCTIER_MC_VERSIONS) out.unshift(process.env.MCTIER_MC_VERSIONS);
  return out;
}
const key = (v) => (String(v).match(/\d+/g) || []).map(Number);
function cmp(a, b) { const x = key(a), y = key(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] || 0) - (x[i] || 0); if (d) return d; } return 0; }

function findInstalledJars() {
  const found = [], seen = new Set();
  for (const dir of versionDirs()) {
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const v of names) {
      const jar = path.join(dir, v, v + '.jar');
      try { const st = fs.statSync(jar); if (st.isFile() && st.size > 1e6 && !seen.has(jar)) { seen.add(jar); found.push({ version: v, path: jar, release: /^\d+(\.\d+)*$/.test(v), mtime: st.mtimeMs }); } } catch (e) { /* not a jar folder */ }
    }
  }
  return found.sort((a, b) => (b.release - a.release) || cmp(a.version, b.version));
}
module.exports = { findInstalledJars, versionDirs };
