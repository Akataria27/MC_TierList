'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load'),
  saveProgress: (state) => ipcRenderer.invoke('save-progress', state),
  jarInstalled: () => ipcRenderer.invoke('jar-installed'),
  jarPick: () => ipcRenderer.invoke('jar-pick'),
  jarInspect: (file) => ipcRenderer.invoke('jar-inspect', file),
  jarBuild: (file) => ipcRenderer.invoke('jar-build', file),
  jarCancel: () => ipcRenderer.invoke('jar-cancel'),
  jarCommit: (opts) => ipcRenderer.invoke('jar-commit', opts),
  jarUndoInfo: () => ipcRenderer.invoke('jar-undo-info'),
  jarUndo: () => ipcRenderer.invoke('jar-undo'),
  uiBuild: (file) => ipcRenderer.invoke('ui-build', file),
  uiStatus: () => ipcRenderer.invoke('ui-status'),
  clearNewFlags: () => ipcRenderer.invoke('clear-new-flags'),
  onJarProgress: (fn) => { ipcRenderer.removeAllListeners('jar-progress'); ipcRenderer.on('jar-progress', (e, p) => fn(p)); },
  saveImage: (dataUrl, name) => ipcRenderer.invoke('save-image', dataUrl, name),
  exportProgress: (state) => ipcRenderer.invoke('export-progress', state),
  importProgress: () => ipcRenderer.invoke('import-progress'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  backupNow: () => ipcRenderer.invoke('backup-now'),
  saveText: (text, name) => ipcRenderer.invoke('save-text', text, name),
  openText: () => ipcRenderer.invoke('open-text'),
  onToggleFullView: (fn) => { ipcRenderer.removeAllListeners('toggle-full-view'); ipcRenderer.on('toggle-full-view', () => fn()); },
});
