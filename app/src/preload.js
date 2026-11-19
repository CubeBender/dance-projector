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
  // own selections without DanS (slot 'A' | 'B')
  setSlotSource: (slot, source) => ipcRenderer.invoke('set-slot-source', slot, source), // 'dans' | 'manual'
  manualUpdate: (slot, patch) => ipcRenderer.invoke('manual-update', slot, patch),      // number, title, titleEn, round
  manualToggle: (slot, fedId) => ipcRenderer.invoke('manual-toggle', slot, fedId),
  manualLetter: (slot, fedId, letter) => ipcRenderer.invoke('manual-letter', slot, fedId, letter),
  manualClear: (slot) => ipcRenderer.invoke('manual-clear', slot),
  // style of the current event
  setTheme: (patch) => ipcRenderer.invoke('set-theme', patch),
  themeReset: () => ipcRenderer.invoke('theme-reset'),
  themeImage: (file) => ipcRenderer.invoke('theme-image', file ? webUtils.getPathForFile(file) : null),
  themeImageRemove: () => ipcRenderer.invoke('theme-image-remove'),
  // judge gallery. files = File objects from a drop (turned into paths here); none = open a file dialog
  judgeUpdate: (fedId, patch) => ipcRenderer.invoke('judge-update', fedId, patch),
  judgeCreate: (judge) => ipcRenderer.invoke('judge-create', judge),
  judgePhotosAdd: (fedId, files, makeMain) => ipcRenderer.invoke('judge-photos-add', fedId, files ? [...files].map((f) => webUtils.getPathForFile(f)) : null, makeMain),
  judgePhotoMain: (fedId, file) => ipcRenderer.invoke('judge-photo-main', fedId, file),
  judgePhotoDelete: (fedId, file) => ipcRenderer.invoke('judge-photo-delete', fedId, file),
  judgeDelete: (fedId) => ipcRenderer.invoke('judge-delete', fedId),
  judgeCrop: (fedId, crop, file) => ipcRenderer.invoke('judge-crop', fedId, crop, file),
  judgePhotoRotate: (fedId, file, degrees) => ipcRenderer.invoke('judge-photo-rotate', fedId, file, degrees), // -> { state, file }
  galleryImport: (dir) => ipcRenderer.invoke('gallery-import', dir), // no dir = folder dialog
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  // pushed from the main process
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
});
