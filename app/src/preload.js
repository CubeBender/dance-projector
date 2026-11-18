'use strict';
// The only bridge between the operator window and the main process. The window gets window.dp with these
// calls and nothing else (no Node, no file access). Each call returns the new window state.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dp', {
  state: () => ipcRenderer.invoke('state'),
  // server and event
  setServer: (url) => ipcRenderer.invoke('set-server', url),
  saveServer: (entry, oldUrl) => ipcRenderer.invoke('save-server', entry, oldUrl),
  removeServer: (url) => ipcRenderer.invoke('remove-server', url),
  refreshEvents: () => ipcRenderer.invoke('refresh-events'),
  setEvent: (id) => ipcRenderer.invoke('set-event', id),
  // data mode ('manual' | 'ondemand' | 'auto') and the on-demand read
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  fetchNow: () => ipcRenderer.invoke('fetch-now'),
  // projection
  push: () => ipcRenderer.invoke('push'),
  setProjectionAuto: (on) => ipcRenderer.invoke('set-projection-auto', on),
  // what is on screen
  assign: (slot, compId) => ipcRenderer.invoke('assign', slot, compId),
  setSlot: (slot, patch) => ipcRenderer.invoke('set-slot', slot, patch),
  setOption: (patch) => ipcRenderer.invoke('set-option', patch),
  // judge panels
  panelToggle: (compId, personId) => ipcRenderer.invoke('panel-toggle', compId, personId),
  panelReset: (compId) => ipcRenderer.invoke('panel-reset', compId),
  panelClear: (compId) => ipcRenderer.invoke('panel-clear', compId),
  // style of the current event
  setTheme: (patch) => ipcRenderer.invoke('set-theme', patch),
  themeReset: () => ipcRenderer.invoke('theme-reset'),
  themeImage: (file) => ipcRenderer.invoke('theme-image', file ? webUtils.getPathForFile(file) : null),
  themeImageRemove: () => ipcRenderer.invoke('theme-image-remove'),
  // judges: names and photos
  judgeName: (fedId, name) => ipcRenderer.invoke('judge-name', fedId, name),
  judgePhoto: (fedId, file) => ipcRenderer.invoke('judge-photo', fedId, file ? webUtils.getPathForFile(file) : null),
  judgeCrop: (fedId, crop) => ipcRenderer.invoke('judge-crop', fedId, crop),
  judgePhotoRemove: (fedId) => ipcRenderer.invoke('judge-photo-remove', fedId),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  // pushed from the main process
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
});
