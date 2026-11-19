'use strict';
// Electron main process: owns the data, talks to DanS (read-only), serves the output pages and answers the
// operator window over IPC.
//
// Data flow:
//   DanS ──(poller: auto / on demand)──> raw ──> buildModel ──> applyPanels ──> outputState = draft
//   offline copy (cache/<event>.json) ──┘                                              │
//                                                       Push to projection ──> pushed ─┴─> output server ──> OBS
//
// The operator window never reaches DanS or the files itself; it asks this process through preload.js.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { DansClient } = require('./dans');
const { Poller, FixturePoller, eventIdOf } = require('./poller');
const { buildModel } = require('./model');
const { Store, normalizeServer } = require('./store');
const { OutputServer } = require('./server');
const { Projection } = require('./projection');
const { applyPanels, togglePanel } = require('./panels');
const { cleanTheme, themeFor, themeKey } = require('./theme');
const { outputState, judgeView, cleanCrop } = require('./view');
const { sortForImport, mainPhoto } = require('./gallery');

// Command-line options: --fixture=<file> plays back a saved event instead of DanS; --data=<folder> uses a
// separate settings folder (handy for testing next to the real instance).
const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const fixtureFile = arg('fixture');
if (arg('data')) app.setPath('userData', path.resolve(arg('data')));

let win, store, poller, server, dans, projection;
let events = [];                                // events offered in the event list
let raw = null, model = null;                   // latest DanS data and the model built from it
let status = { connected: false };              // connection status shown in the window
let outputAddr = null;                          // address the output server listens on
const MODES = ['manual', 'ondemand', 'auto'];

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

// ---------------------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------------------

// Re-encode an image as a plain baseline JPEG, at most maxWidth wide. Some JPEGs (seen with a progressive
// phone photo) display in Chrome but not in the OBS browser source; a fresh encode always works and keeps
// files small.
function normalizeImage(src, dest, maxWidth = 900) {
  let img = nativeImage.createFromPath(src);
  if (img.isEmpty()) throw new Error('could not be read – not a JPEG/PNG/WebP image, or the file is damaged or incomplete');
  const { width } = img.getSize();
  if (width > maxWidth) img = img.resize({ width: maxWidth, quality: 'best' });
  fs.writeFileSync(dest, img.toJPEG(90));
}

// SHA-1 of a file's bytes. Identifies an original photo, so importing the same folder again skips it.
const fileHash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

// Adds one image file to a judge's gallery: re-encode, copy into photos/, remember its hash.
// Returns false when this exact file is already in the judge's gallery.
function addJudgePhoto(fedId, file, { makeMain = false } = {}) {
  const hash = fileHash(file);
  if (store.hasPhotoHash(fedId, hash)) return false;
  const tmp = path.join(app.getPath('temp'), `dp-photo-${Date.now()}.jpg`);
  normalizeImage(file, tmp);
  try { store.addPhoto(fedId, tmp, { hash, makeMain }); } finally { fs.rm(tmp, { force: true }, () => {}); }
  return true;
}

// Imports a folder of photos named "IDT_Surname_Name[ Number].ext" (gallery.js parseFileName).
// New judges get the names from the file name; names already in the gallery are kept, because the operator
// may have corrected them. Returns a report for the window.
function importGalleryFolder(dir) {
  const report = { added: 0, judges: new Set(), duplicates: 0, unrecognised: [], failed: [] };
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => ({ name: d.name }));
  for (const { f, info } of sortForImport(files)) {
    if (!info) { if (!f.name.startsWith('.')) report.unrecognised.push(f.name); continue; }
    try {
      store.ensureJudge(info.idt, { name: info.name, surname: info.surname });
      if (addJudgePhoto(info.idt, path.join(dir, f.name))) { report.added++; report.judges.add(info.idt); } else report.duplicates++;
    } catch (e) { report.failed.push(`${f.name}: ${e.message}`); }
  }
  return { ...report, judges: report.judges.size, folder: dir };
}

// One-time conversion of photos imported before normalisation existed (originals kept in photos-original).
function normalizeExistingPhotos() {
  for (const [fedId, j] of store.galleryEntries()) {
    if (j.normalized !== undefined || !j.photos?.length) continue; // new imports are always re-encoded
    const keep = path.join(store.dir, 'photos-original');
    try {
      fs.mkdirSync(keep, { recursive: true });
      for (const p of j.photos) {
        const file = path.join(store.photoDir, p.file);
        if (!fs.existsSync(path.join(keep, p.file))) fs.copyFileSync(file, path.join(keep, p.file));
        normalizeImage(file, file + '.tmp'); fs.renameSync(file + '.tmp', file);
      }
      store.updateJudge(fedId, { normalized: true });
    } catch (e) { console.error('photo', fedId, e.message); }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Data: events, modes, model
// ---------------------------------------------------------------------------------------------------------

const mode = () => (fixtureFile ? 'auto' : store.cfg.mode); // a fixture always "plays" like automatic mode

// Fills the event list. Manual mode never contacts DanS and lists the events that have an offline copy.
// The other modes ask DanS and fall back to the offline copies when DanS can't be reached.
async function loadEvents() {
  if (fixtureFile) { events = [{ ...raw.event, authorities: [{ event_id: raw.event.id, date: raw.event.date }] }]; return; }
  if (mode() === 'manual') { events = store.listSnapshots(); status = { connected: false, offline: true }; return; }
  try { events = await dans.events(); if (!status.connected) status = { connected: true, error: null, lastOk: Date.now() }; }
  catch (e) { events = store.listSnapshots(); status = { connected: false, error: String(e.message || e) }; }
}

// Called when the chosen event or the mode changes. Shows the offline copy straight away (if there is one),
// then lets the poller take over according to the mode.
function selectEvent() {
  if (fixtureFile) return;
  const ev = events.find((e) => eventIdOf(e) === store.cfg.eventId) || null;
  const cached = ev ? store.loadSnapshot(eventIdOf(ev)) : null;
  raw = cached; rebuild();
  if (!ev) { poller.seed(null, null); return; }
  if (mode() === 'auto') poller.setEvent(ev);   // full read now, then every pollMs
  else poller.seed(ev, cached);                 // wait for Fetch now (or never, in manual mode)
}

// Starts or stops automatic reading to match the mode.
function applyMode() {
  if (fixtureFile) return;
  if (mode() === 'auto') poller.start(); else poller.stop();
}

// (Re)connects to the server in the config: new client, fresh event list, reselect the event.
async function connect() {
  dans = new DansClient(store.cfg.server);
  poller.setClient(dans);
  await loadEvents();
  selectEvent();
  publish();
}

// "Follow running": a slot with follow on takes over a newly running competition when its own isn't running.
function applyFollow() {
  if (!model) return false;
  let changed = false;
  for (const key of store.cfg.split ? ['A', 'B'] : ['A']) {
    const s = store.cfg.slots[key];
    if (!s.follow) continue;
    const other = store.cfg.slots[key === 'A' ? 'B' : 'A'].competitionId;
    const mine = model.competitions.find((c) => c.id === s.competitionId);
    if (mine?.running) continue;
    const cand = model.competitions.filter((c) => c.running && c.id !== other)
      .sort((a, b) => String(b.round?.started || '').localeCompare(String(a.round?.started || '')) || a.number - b.number)[0];
    if (cand && cand.id !== s.competitionId) { s.competitionId = cand.id; changed = true; }
  }
  if (changed) store.config.save();
  return changed;
}

// Rebuilds the model from the raw data and the operator's panels, then refreshes the draft and the window.
function rebuild() {
  model = raw ? buildModel(raw, { runningStates: store.cfg.runningStates }) : null;
  applyPanels(model, store.panelOverrides(store.cfg.eventId));
  applyFollow();
  publish();
}

// ---------------------------------------------------------------------------------------------------------
// State for the operator window
// ---------------------------------------------------------------------------------------------------------

function rendererState() {
  const slotIds = Object.values(store.cfg.slots).map((s) => s.competitionId);
  const inSlots = new Set();
  model?.competitions.filter((c) => slotIds.includes(c.id)).forEach((c) => c.judges.forEach((j) => inSlots.add(j.personId)));
  const base = outputAddr ? `http://localhost:${outputAddr.port}` : null;
  const theme = themeFor(store.cfg, store.cfg.eventId);
  return {
    config: store.cfg,
    mode: mode(),
    status,
    fixture: !!fixtureFile,
    dataTime: raw?.fetchedAt || null,     // when the shown data was read from DanS
    events: events.map((e) => ({ id: eventIdOf(e), name: e.name, abbreviation: e.abbreviation, date: e.date ?? e.authorities?.[0]?.date, location: e.location, offline: !!e.fetchedAt })),
    event: model?.event || null,
    competitions: (model?.competitions || []).map((c) => ({
      id: c.id, number: c.number, title: c.title, titleShort: c.titleShort, state: c.state,
      checkInEnd: c.checkInEnd, registered: c.registered, checkedIn: c.checkedIn, running: c.running,
      judgeCount: c.judges.length,
      // judge panel: what will be shown, what DanS says, and which of the two it is
      judgeIds: c.judges.map((j) => j.personId), dansJudgeIds: (c.dansJudges || []).map((j) => j.personId), panelSource: c.panelSource,
      round: c.round && { name: c.round.name, state: c.round.state, competes: c.round.competes, advances: c.round.advances,
        currentDance: c.round.currentDance, dances: c.round.dances.map((d) => ({ abbr: d.abbr, name: d.name, completed: d.completed })) },
    })),
    judges: [...(model?.judges.values() || [])].map((j) => {
      const v = judgeView(j, store);
      // displayName = the name as the projection shows it (gallery names and name on screen win over DanS)
      return { ...j, displayName: v.name, photo: v.photo && base ? base + v.photo : null, crop: v.crop, inSlots: inSlots.has(j.personId) };
    }).sort((a, b) => a.letter.localeCompare(b.letter, 'cs')),
    gallery: galleryView(base, inSlots),
    theme: { ...theme, imageUrl: theme.image && base ? `${base}/media/${encodeURIComponent(theme.image)}` : null },
    projection: { auto: projection.auto, changes: projection.changes(), pushedAt: projection.pushedAt },
    outputs: outputAddr ? {
      port: outputAddr.port,
      base,
      hosts: ['localhost', ...lanAddresses()],
      // Heats are not needed for now (D-13); the page still exists at /out/heats.html.
      pages: [
        { name: 'Judges – slot A', path: '/out/judges.html?slot=A' },
        { name: 'Judges – slot B', path: '/out/judges.html?slot=B' },
        { name: 'Floor overview (split or whole floor)', path: '/out/split.html' },
        { name: 'Schedule', path: '/out/schedule.html' },
        { name: 'Lower third for camera – slot A', path: '/out/lowerthird.html?slot=A' },
        { name: 'Lower third for camera – slot B', path: '/out/lowerthird.html?slot=B' },
      ],
    } : null,
  };
}

// The Judges tab: every judge in the gallery plus every judge of the current event (even without a gallery
// entry yet), with all photos. DanS names are shown as hints next to the editable gallery names.
function galleryView(base, inSlots) {
  const byId = new Map();
  for (const [fedId, g] of store.galleryEntries()) byId.set(fedId, { fedId, g, dans: null, inGallery: true });
  for (const j of model?.judges.values() || []) {
    if (!j.fedId) continue;
    const row = byId.get(j.fedId) || { fedId: j.fedId, g: {}, dans: null, inGallery: false };
    row.dans = j; byId.set(j.fedId, row);
  }
  const url = (file) => (base ? `${base}/photos/${encodeURIComponent(file)}` : null);
  return [...byId.values()].map(({ fedId, g, dans, inGallery }) => ({
    fedId, inGallery,
    name: g.name || '', surname: g.surname || '', displayName: g.displayName || '',
    dansName: dans?.name || '', dansSurname: dans?.surname || '',
    letter: dans?.letter || '', inEvent: !!dans, inSlots: !!dans && inSlots.has(dans.personId),
    main: mainPhoto(g)?.file || null,
    photos: (g.photos || []).map((p) => ({ file: p.file, url: url(p.file), crop: cleanCrop(p.crop) })),
  })).sort((a, b) => (a.surname || a.dansSurname).localeCompare(b.surname || b.dansSurname, 'cs'));
}

// Recomputes the draft and sends the window a new state. Status-only changes go as a lighter 'status' message.
let lastRendererJson = '';
function publish() {
  projection?.setDraft(outputState(model, raw || {}, store, status));
  if (!win || win.isDestroyed()) return;
  const st = rendererState();
  const json = JSON.stringify({ ...st, status: { connected: st.status.connected, error: st.status.error } });
  if (json === lastRendererJson) { win.webContents.send('status', st.status); return; }
  lastRendererJson = json;
  win.webContents.send('state', st);
}

// ---------------------------------------------------------------------------------------------------------
// IPC: requests from the operator window (see preload.js for the list)
// ---------------------------------------------------------------------------------------------------------

function setupIpc() {
  ipcMain.handle('state', () => rendererState());

  // ---- server and event ----
  ipcMain.handle('set-server', async (_e, url) => { store.updateConfig({ server: normalizeServer(url) }); await connect(); return rendererState(); });
  ipcMain.handle('save-server', (_e, entry, oldUrl) => {
    const editingCurrent = oldUrl && normalizeServer(oldUrl) === store.cfg.server;
    store.saveServer(entry, oldUrl);
    const url = normalizeServer(entry.url);
    if (editingCurrent && url !== store.cfg.server) { store.updateConfig({ server: url }); connect(); } // publishes when done
    return rendererState();
  });
  ipcMain.handle('remove-server', (_e, url) => { store.removeServer(url); return rendererState(); });
  ipcMain.handle('refresh-events', async () => { await loadEvents(); publish(); return rendererState(); });
  ipcMain.handle('set-event', (_e, id) => {
    store.updateConfig({ eventId: id, slots: { A: { competitionId: null }, B: { competitionId: null } } });
    selectEvent(); return rendererState();
  });

  // ---- data mode and on-demand fetch ----
  ipcMain.handle('set-mode', async (_e, m) => {
    if (!MODES.includes(m) || m === store.cfg.mode) return rendererState();
    store.updateConfig({ mode: m });
    applyMode();
    // Manual mode lists offline copies only; the other modes need DanS's event list. connect() handles both.
    await connect();
    return rendererState();
  });
  ipcMain.handle('fetch-now', async () => {
    try { await poller.fetchOnce(); } catch { /* the error is already in poller.status and shown in the window */ }
    status = poller.status;
    publish();
    return rendererState();
  });

  // ---- projection ----
  ipcMain.handle('push', () => {
    projection.push();
    store.cleanupFiles(projection.referencedFiles()); // photos replaced since the last push can go now
    publish(); return rendererState();
  });
  ipcMain.handle('set-projection-auto', (_e, on) => { store.updateConfig({ projectionAuto: !!on }); projection.setAuto(!!on); publish(); return rendererState(); });

  // ---- slots (which competition is on screen) ----
  ipcMain.handle('assign', (_e, slot, compId) => {
    const s = store.cfg.slots[slot]; if (!s) return rendererState();
    const other = store.cfg.slots[slot === 'A' ? 'B' : 'A'];
    s.competitionId = s.competitionId === compId ? null : compId;
    if (s.competitionId && other.competitionId === compId) other.competitionId = null;
    store.config.save(); rebuild(); return rendererState();
  });
  ipcMain.handle('set-slot', (_e, slot, patch) => {
    const allowed = {};
    for (const k of ['label', 'labelEn', 'color', 'follow']) if (k in patch) allowed[k] = patch[k];
    store.updateConfig({ slots: { [slot]: allowed } }); rebuild(); return rendererState();
  });

  // ---- judge panels (panels.js) ----
  const comp = (id) => model?.competitions.find((c) => c.id === id);
  ipcMain.handle('panel-toggle', (_e, compId, personId) => {
    const c = comp(compId); if (!c) return rendererState();
    const current = store.panelOverrides(store.cfg.eventId)[compId];
    store.setPanel(store.cfg.eventId, compId, togglePanel(current, c.dansJudges.map((j) => j.personId), personId));
    rebuild(); return rendererState();
  });
  ipcMain.handle('panel-reset', (_e, compId) => { store.setPanel(store.cfg.eventId, compId, null); rebuild(); return rendererState(); });
  ipcMain.handle('panel-clear', (_e, compId) => { store.setPanel(store.cfg.eventId, compId, []); rebuild(); return rendererState(); });

  // ---- style of the current event (theme.js) ----
  const setTheme = (patch) => store.updateConfig({ themes: { [themeKey(store.cfg.eventId)]: cleanTheme(patch) } });
  ipcMain.handle('set-theme', (_e, patch) => { setTheme(patch); rebuild(); return rendererState(); });
  ipcMain.handle('theme-reset', () => { delete store.cfg.themes[themeKey(store.cfg.eventId)]; store.config.save(); rebuild(); return rendererState(); });
  ipcMain.handle('theme-image', async (_e, filePath) => {
    let file = filePath;
    if (!file) {
      const r = await dialog.showOpenDialog(win, { title: 'Background image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
      if (r.canceled || !r.filePaths[0]) return rendererState();
      file = r.filePaths[0];
    }
    try {
      const name = `bg-${Date.now()}.jpg`;
      normalizeImage(file, path.join(store.mediaDir, name), 1920); // full HD is all the projection needs
      setTheme({ image: name, background: 'image' });
    } catch (e) { dialog.showErrorBox('Background image', `This file could not be used: ${e.message}`); }
    rebuild(); return rendererState();
  });
  ipcMain.handle('theme-image-remove', () => {
    const bg = themeFor(store.cfg, store.cfg.eventId).background;
    setTheme({ image: null, background: bg === 'image' ? 'lights' : bg }); // the file goes in the next cleanup
    rebuild(); return rendererState();
  });

  // ---- other settings ----
  ipcMain.handle('set-option', (_e, patch) => {
    const allowed = {};
    if (Array.isArray(patch.runningStates)) allowed.runningStates = patch.runningStates.map(String).filter(Boolean);
    if (patch.language) {
      const p = ['cs', 'en'].includes(patch.language.primary) ? patch.language.primary : store.cfg.language.primary;
      let s = ['cs', 'en', 'none'].includes(patch.language.secondary) ? patch.language.secondary : store.cfg.language.secondary;
      if (s === p) s = p === 'cs' ? 'en' : 'cs';
      allowed.language = { primary: p, secondary: s };
    }
    if ('split' in patch) allowed.split = !!patch.split;
    if (Number(patch.pollMs) >= 500) { allowed.pollMs = Number(patch.pollMs); if (poller.intervalMs) poller.intervalMs = allowed.pollMs; }
    store.updateConfig(allowed); rebuild(); return rendererState();
  });

  // ---- judge gallery: names and photos (gallery.js, store.js) ----
  const imageFilter = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }];
  // Name fields: name, surname, displayName (optional name on screen). Empty text removes the field.
  ipcMain.handle('judge-update', (_e, fedId, patch) => {
    const clean = {};
    for (const k of ['name', 'surname', 'displayName']) if (k in patch) clean[k] = String(patch[k] || '').trim();
    store.ensureJudge(fedId); store.updateJudge(fedId, clean); rebuild(); return rendererState();
  });
  // New judge typed in by hand. The IDT is required and must be a number, like the federation ids.
  ipcMain.handle('judge-create', (_e, { fedId, name, surname }) => {
    fedId = String(fedId || '').trim();
    if (!/^\d{3,}$/.test(fedId)) return { ...rendererState(), error: 'The IDT must be a number.' };
    store.ensureJudge(fedId, { name: String(name || '').trim(), surname: String(surname || '').trim() });
    rebuild(); return rendererState();
  });
  // Adds photos to one judge: from a file dialog (several at once) or files dropped on the card.
  // makeMain: the first added photo becomes the portrait (used when dropping on the big photo).
  ipcMain.handle('judge-photos-add', async (_e, fedId, filePaths, makeMain = false) => {
    let files = filePaths?.length ? filePaths : null;
    if (!files) {
      const r = await dialog.showOpenDialog(win, { title: 'Add judge photos', properties: ['openFile', 'multiSelections'], filters: imageFilter });
      if (r.canceled || !r.filePaths.length) return rendererState();
      files = r.filePaths;
    }
    store.ensureJudge(fedId);
    const failed = [];
    files.forEach((f, i) => {
      try { addJudgePhoto(fedId, f, { makeMain: makeMain && i === 0 }); } catch (e) { failed.push(`${path.basename(f)}: ${e.message}`); }
    });
    if (failed.length) dialog.showErrorBox('Judge photos', `These files could not be used:\n${failed.join('\n')}`);
    rebuild(); return rendererState();
  });
  ipcMain.handle('judge-photo-main', (_e, fedId, file) => { store.setMainPhoto(fedId, file); rebuild(); return rendererState(); });
  ipcMain.handle('judge-photo-delete', (_e, fedId, file) => { store.deletePhoto(fedId, file); rebuild(); return rendererState(); });
  // Crop of one photo; without a file name it is the main photo's.
  ipcMain.handle('judge-crop', (_e, fedId, crop, file) => {
    const target = file || mainPhoto(store.judge(fedId))?.file;
    if (target) store.setPhotoCrop(fedId, target, crop ? cleanCrop(crop) : null);
    rebuild(); return rendererState();
  });
  // Imports a whole folder. The dialog starts in Docs/judges of this project when it exists.
  ipcMain.handle('gallery-import', async (_e, dirPath) => {
    let dir = dirPath;
    if (!dir) {
      const docs = path.join(__dirname, '..', '..', '..', 'Docs', 'judges');
      const r = await dialog.showOpenDialog(win, { title: 'Import judge photos from a folder', properties: ['openDirectory'], defaultPath: fs.existsSync(docs) ? docs : undefined });
      if (r.canceled || !r.filePaths[0]) return { state: rendererState(), report: null };
      dir = r.filePaths[0];
    }
    const report = importGalleryFolder(dir);
    rebuild();
    return { state: rendererState(), report };
  });

  // Opens an output page in the normal browser; only addresses of our own output server.
  ipcMain.handle('open-url', (_e, url) => { if (/^https?:\/\/(localhost|127\.0\.0\.1|[\d.]+):\d+\//.test(url)) shell.openExternal(url); });
}

// ---------------------------------------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------------------------------------

// Older configs kept the whole-floor accent in "wholeColor". Move it into the current event's style once.
function migrateConfig() {
  const cfg = store.cfg;
  if (cfg.wholeColor) {
    const key = themeKey(cfg.eventId);
    cfg.themes[key] = { accent: cfg.wholeColor, ...cfg.themes[key] };
    delete cfg.wholeColor;
    store.config.save();
  }
}

async function start() {
  store = new Store(app.getPath('userData'));
  migrateConfig();
  normalizeExistingPhotos();
  server = new OutputServer({
    outputsDir: path.join(__dirname, '..', 'outputs'),
    photoDir: store.photoDir,
    mediaDir: store.mediaDir,
    brandDir: path.join(__dirname, '..', '..', '..', 'obs', 'pages'), // for the background in the app's preview
  });
  // The projection starts with whatever was pushed last time, so a restart doesn't change the screen.
  projection = new Projection({ server, file: path.join(store.dir, 'pushed.json') });
  projection.setAuto(store.cfg.projectionAuto);
  store.cleanupFiles(projection.referencedFiles());
  try {
    outputAddr = await server.listen(store.cfg.outputPort, store.cfg.outputHost);
  } catch (e) {
    dialog.showErrorBox('Output server', `Port ${store.cfg.outputPort} is busy: ${e.message}`);
  }

  if (fixtureFile) {
    raw = JSON.parse(fs.readFileSync(path.resolve(fixtureFile), 'utf8'));
    poller = new FixturePoller(raw);
  } else {
    poller = new Poller({ dans: new DansClient(store.cfg.server), intervalMs: store.cfg.pollMs });
  }
  // Every successful read: keep an offline copy (for manual mode / starting without DanS) and rebuild.
  poller.on('raw', (r) => { raw = r; if (!fixtureFile) store.saveSnapshot(r); rebuild(); });
  poller.on('status', (s) => { const changed = s.connected !== status.connected || s.error !== status.error; status = s; if (changed) publish(); else win?.webContents.send('status', s); });

  setupIpc();
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1100, minHeight: 680, backgroundColor: '#0f1115', title: 'Dance Projector',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });

  if (fixtureFile) { await loadEvents(); poller.start(); }
  else { dans = new DansClient(store.cfg.server); poller.setClient(dans); await loadEvents(); selectEvent(); applyMode(); }
  publish();
}

app.whenReady().then(start);
app.on('window-all-closed', () => { store?.flush(); server?.close(); poller?.stop(); app.quit(); });
