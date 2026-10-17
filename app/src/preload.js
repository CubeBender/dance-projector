'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dp', {
  state: () => ipcRenderer.invoke('state'),
  setServer: (url) => ipcRenderer.invoke('set-server', url),
  refreshEvents: () => ipcRenderer.invoke('refresh-events'),
  setEvent: (id) => ipcRenderer.invoke('set-event', id),
  assign: (slot, compId) => ipcRenderer.invoke('assign', slot, compId),
  setSlot: (slot, patch) => ipcRenderer.invoke('set-slot', slot, patch),
  setOption: (patch) => ipcRenderer.invoke('set-option', patch),
  judgeName: (fedId, name) => ipcRenderer.invoke('judge-name', fedId, name),
  judgePhoto: (fedId, file) => ipcRenderer.invoke('judge-photo', fedId, file ? webUtils.getPathForFile(file) : null),
  judgeCrop: (fedId, crop) => ipcRenderer.invoke('judge-crop', fedId, crop),
  judgePhotoRemove: (fedId) => ipcRenderer.invoke('judge-photo-remove', fedId),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
});
