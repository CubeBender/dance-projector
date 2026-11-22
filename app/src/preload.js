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
  // order of the judge cards on screen: mode 'surname' | 'firstname' | 'letter' | 'custom'; delta -1 / +1
  setJudgeSort: (slot, mode) => ipcRenderer.invoke('set-judge-sort', slot, mode),
  judgeMove: (slot, fedId, delta) => ipcRenderer.invoke('judge-move', slot, fedId, delta),
  // own selections without DanS (slot 'A' | 'B')
  setSlotSource: (slot, source) => ipcRenderer.invoke('set-slot-source', slot, source), // 'dans' | 'manual'
  manualUpdate: (slot, patch) => ipcRenderer.invoke('manual-update', slot, patch),      // number, title, titleEn, round
  manualToggle: (slot, fedId) => ipcRenderer.invoke('manual-toggle', slot, fedId),
  manualLetter: (slot, fedId, letter) => ipcRenderer.invoke('manual-letter', slot, fedId, letter),
  manualClear: (slot) => ipcRenderer.invoke('manual-clear', slot),
  // style of the current event
  setTheme: (patch) => ipcRenderer.invoke('set-theme', patch),
  themePreset: (id) => ipcRenderer.invoke('theme-preset', id),
  themeReset: () => ipcRenderer.invoke('theme-reset'),
  themeImage: (file) => ipcRenderer.invoke('theme-image', file ? webUtils.getPathForFile(file) : null),
  themeImageRemove: () => ipcRenderer.invoke('theme-image-remove'),
  // judge gallery. files = File objects from a drop (turned into paths here); none = open a file dialog
  judgeUpdate: (fedId, patch) => ipcRenderer.invoke('judge-update', fedId, patch),
  judgeCreate: (judge) => ipcRenderer.invoke('judge-create', judge),
  judgePhotosAdd: (fedId, files, makeMain) => ipcRenderer.invoke('judge-photos-add', fedId, files ? [...files].map((f) => webUtils.getPathForFile(f)) : null, makeMain),
  judgePhotoBytes: (fedId, bytes) => ipcRenderer.invoke('judge-photo-bytes', fedId, bytes), // Ctrl+V on a judge card (D-28)
  judgePhotoMain: (fedId, file) => ipcRenderer.invoke('judge-photo-main', fedId, file),
  judgePhotoDelete: (fedId, file) => ipcRenderer.invoke('judge-photo-delete', fedId, file),
  judgeDelete: (fedId) => ipcRenderer.invoke('judge-delete', fedId),
  judgeCrop: (fedId, crop, file) => ipcRenderer.invoke('judge-crop', fedId, crop, file),
  judgePhotoRotate: (fedId, file, degrees) => ipcRenderer.invoke('judge-photo-rotate', fedId, file, degrees), // -> { state, file }
  galleryImport: (dir) => ipcRenderer.invoke('gallery-import', dir), // no dir = folder dialog
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  // ---- competitors (D-22) ----
  // what the competitor screen shows: { competitionId, number, title, titleEn, round, numbers (text), mode, spotlight }
  compScreen: (patch) => ipcRenderer.invoke('comp-screen', patch),
  compInRound: (number, on) => ipcRenderer.invoke('comp-in-round', number, on),
  compLoadRound: (compId) => ipcRenderer.invoke('comp-load-round', compId),
  compRefreshStartlist: () => ipcRenderer.invoke('comp-refresh-startlist'), // start numbers given since the last read
  // reading a DanS printout (D-24): bytes of a photo -> { result } | { error }; apply = what the operator checked
  printoutRead: (bytes, opts = {}) => ipcRenderer.invoke('printout-read', bytes, opts),
  printoutRotate: (deg) => ipcRenderer.invoke('printout-rotate', deg),
  printoutApply: (p) => ipcRenderer.invoke('printout-apply', p),
  onPrintout: (fn) => ipcRenderer.on('printout', (_e, r) => fn(r)), // a printout photo arrived from the phone
  pushCompetitors: () => ipcRenderer.invoke('push-competitors'),
  // ---- results announcement (D-26) ----
  resultsSet: (patch) => ipcRenderer.invoke('results-set', patch),       // { competitionId } | { scope: 'top3' | 'all' }
  resultsLoad: (compId) => ipcRenderer.invoke('results-load', compId),   // reads the final's places from DanS
  resultsStep: (move) => ipcRenderer.invoke('results-step', move),       // { delta: ±1 } | { step: n | 'all' }; on screen at once
  // heats (D-29): dir +1 = Next heat, -1 = Back; following the judges' marks on / off for one round
  heatMove: (roundId, dir) => ipcRenderer.invoke('heat-move', roundId, dir),
  heatAuto: (roundId, on) => ipcRenderer.invoke('heat-auto', roundId, on),
  // the list. A competitor is addressed by its key ('dans:<id>' or 'm:<id>', see competitors.js), not its number,
  // because many have no start number yet. New: { number (optional), kind, people: [{ name, surname, idt }] }
  compCreate: (c) => ipcRenderer.invoke('comp-create', c),
  compUpdate: (key, patch) => ipcRenderer.invoke('comp-update', key, patch),
  compDelete: (key) => ipcRenderer.invoke('comp-delete', key),
  // photos. files = File objects from a drop; a file without a path on disk (dragged out of another app) is sent
  // as bytes instead. none = open a file dialog.
  compPhotosAdd: async (key, files, makeMain) => {
    if (!files) return ipcRenderer.invoke('comp-photos-add', key, null, makeMain);
    const list = [...files];
    const paths = list.map((f) => webUtils.getPathForFile(f));
    if (paths.every(Boolean)) return ipcRenderer.invoke('comp-photos-add', key, paths, makeMain);
    let st = null;
    for (const [i, f] of list.entries()) st = await ipcRenderer.invoke('comp-photo-bytes', { key }, new Uint8Array(await f.arrayBuffer()), makeMain && i === 0);
    return st;
  },
  // bytes = Uint8Array (pasted image, webcam shot); target = { key } or { number } -> state with .key of the competitor
  compPhotoBytes: (target, bytes, makeMain = true) => ipcRenderer.invoke('comp-photo-bytes', target, bytes, makeMain),
  compPhotoMain: (key, file) => ipcRenderer.invoke('comp-photo-main', key, file),
  compPhotoDelete: (key, file) => ipcRenderer.invoke('comp-photo-delete', key, file),
  compCrop: (key, crop, file) => ipcRenderer.invoke('comp-crop', key, crop, file),
  compPhotoRotate: (key, file, degrees) => ipcRenderer.invoke('comp-photo-rotate', key, file, degrees), // -> { state, file }
  setWebcam: (id) => ipcRenderer.invoke('set-webcam', id),
  cstsLookup: (idt) => ipcRenderer.invoke('csts-lookup', idt), // -> { found } | { error }
  phoneUpload: (patch) => ipcRenderer.invoke('phone-upload', patch), // { enabled } | { newKey: true }
  qr: (url) => ipcRenderer.invoke('qr', url),                       // -> data: URL of the QR code picture
  // pushed from the main process
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
  onNotice: (fn) => ipcRenderer.on('notice', (_e, n) => fn(n)), // e.g. a photo arrived from the phone
});
