'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DansClient } = require('./dans');
const { Poller, FixturePoller, eventIdOf } = require('./poller');
const { buildModel } = require('./model');
const { Store } = require('./store');
const { OutputServer } = require('./server');
const { outputState, judgeView, cleanCrop } = require('./view');

const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const fixtureFile = arg('fixture');
if (arg('data')) app.setPath('userData', path.resolve(arg('data')));

let win, store, poller, server, dans;
let events = [];
let raw = null, model = null, status = { connected: false };
let outputAddr = null;

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

function wantedRounds() {
  if (!model) return [];
  const ids = Object.values(store.cfg.slots).map((s) => s.competitionId);
  return model.competitions.filter((c) => ids.includes(c.id) && c.round).map((c) => c.round.id);
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

function rebuild() {
  if (!raw) { model = null; publish(); return; }
  model = buildModel(raw, { runningStates: store.cfg.runningStates });
  if (applyFollow()) poller.kick?.();
  publish();
}

function rendererState() {
  const slotIds = Object.values(store.cfg.slots).map((s) => s.competitionId);
  const inSlots = new Set();
  model?.competitions.filter((c) => slotIds.includes(c.id)).forEach((c) => c.judges.forEach((j) => inSlots.add(j.personId)));
  const base = outputAddr ? `http://localhost:${outputAddr.port}` : null;
  return {
    config: store.cfg,
    status,
    fixture: !!fixtureFile,
    events: events.map((e) => ({ id: eventIdOf(e), name: e.name, abbreviation: e.abbreviation, date: e.authorities?.[0]?.date, location: e.location })),
    event: model?.event || null,
    competitions: (model?.competitions || []).map((c) => ({
      id: c.id, number: c.number, title: c.title, titleShort: c.titleShort, state: c.state,
      checkInEnd: c.checkInEnd, registered: c.registered, checkedIn: c.checkedIn, running: c.running,
      judgeCount: c.judges.length,
      round: c.round && { name: c.round.name, state: c.round.state, competes: c.round.competes, advances: c.round.advances,
        currentDance: c.round.currentDance, dances: c.round.dances.map((d) => ({ abbr: d.abbr, name: d.name, completed: d.completed })) },
    })),
    judges: [...(model?.judges.values() || [])].map((j) => {
      const v = judgeView(j, store);
      return { ...j, displayName: store.judge(j.fedId).displayName || '', photo: v.photo && base ? base + v.photo : null, crop: v.crop, inSlots: inSlots.has(j.personId) };
    }).sort((a, b) => a.letter.localeCompare(b.letter, 'cs')),
    outputs: outputAddr ? {
      port: outputAddr.port,
      hosts: ['localhost', ...lanAddresses()],
      pages: [
        { name: 'Heats – slot A', path: '/out/heats.html?slot=A' },
        { name: 'Heats – slot B', path: '/out/heats.html?slot=B' },
        { name: 'Judges – slot A', path: '/out/judges.html?slot=A' },
        { name: 'Judges – slot B', path: '/out/judges.html?slot=B' },
        { name: 'Floor overview (split or whole floor)', path: '/out/split.html' },
      ],
    } : null,
  };
}

let lastRendererJson = '';
function publish() {
  server?.publish(outputState(model, raw || {}, store, status));
  if (!win || win.isDestroyed()) return;
  const st = rendererState();
  const json = JSON.stringify({ ...st, status: { connected: st.status.connected, error: st.status.error } });
  if (json === lastRendererJson) { win.webContents.send('status', st.status); return; }
  lastRendererJson = json;
  win.webContents.send('state', st);
}

async function loadEvents() {
  if (fixtureFile) { events = [{ ...raw.event, authorities: [{ event_id: raw.event.id, date: raw.event.date }] }]; return; }
  try { events = await dans.events(); } catch (e) { events = []; status = { connected: false, error: String(e.message || e) }; }
}

function selectEvent() {
  if (fixtureFile) return;
  const ev = events.find((e) => eventIdOf(e) === store.cfg.eventId) || null;
  poller.setEvent(ev);
}

async function connect() {
  dans = new DansClient(store.cfg.server);
  poller.setClient(dans);
  await loadEvents();
  selectEvent();
  publish();
}

function setupIpc() {
  ipcMain.handle('state', () => rendererState());
  ipcMain.handle('set-server', async (_e, url) => { store.updateConfig({ server: url }); await connect(); return rendererState(); });
  ipcMain.handle('refresh-events', async () => { await loadEvents(); publish(); return rendererState(); });
  ipcMain.handle('set-event', (_e, id) => {
    store.updateConfig({ eventId: id, slots: { A: { competitionId: null }, B: { competitionId: null } } });
    raw = null; model = null; selectEvent(); publish(); return rendererState();
  });
  ipcMain.handle('assign', (_e, slot, compId) => {
    const s = store.cfg.slots[slot]; if (!s) return rendererState();
    const other = store.cfg.slots[slot === 'A' ? 'B' : 'A'];
    s.competitionId = s.competitionId === compId ? null : compId;
    if (s.competitionId && other.competitionId === compId) other.competitionId = null;
    store.config.save(); poller.kick(); rebuild(); return rendererState();
  });
  ipcMain.handle('set-slot', (_e, slot, patch) => {
    const allowed = {};
    for (const k of ['label', 'labelEn', 'color', 'follow']) if (k in patch) allowed[k] = patch[k];
    store.updateConfig({ slots: { [slot]: allowed } }); rebuild(); return rendererState();
  });
  ipcMain.handle('set-option', (_e, patch) => {
    const allowed = {};
    if (Array.isArray(patch.runningStates)) allowed.runningStates = patch.runningStates.map(String).filter(Boolean);
    if (patch.language) {
      const p = ['cs', 'en'].includes(patch.language.primary) ? patch.language.primary : store.cfg.language.primary;
      let s = ['cs', 'en', 'none'].includes(patch.language.secondary) ? patch.language.secondary : store.cfg.language.secondary;
      if (s === p) s = p === 'cs' ? 'en' : 'cs';
      allowed.language = { primary: p, secondary: s };
    }
    if (['full', 'names', 'numbers'].includes(patch.heatsShow)) allowed.heatsShow = patch.heatsShow;
    if ('split' in patch) allowed.split = !!patch.split;
    if (/^#[0-9a-f]{6}$/i.test(patch.wholeColor || '')) allowed.wholeColor = patch.wholeColor;
    if (Number(patch.pollMs) >= 500) { allowed.pollMs = Number(patch.pollMs); if (poller.intervalMs) poller.intervalMs = allowed.pollMs; }
    store.updateConfig(allowed); rebuild(); return rendererState();
  });
  ipcMain.handle('judge-name', (_e, fedId, displayName) => { store.updateJudge(fedId, { displayName: String(displayName || '').trim() }); rebuild(); return rendererState(); });
  ipcMain.handle('judge-photo', async (_e, fedId, filePath) => {
    let file = filePath;
    if (!file) {
      const r = await dialog.showOpenDialog(win, { title: 'Judge photo', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
      if (r.canceled || !r.filePaths[0]) return rendererState();
      file = r.filePaths[0];
    }
    store.importPhoto(fedId, file); rebuild(); return rendererState();
  });
  ipcMain.handle('judge-crop', (_e, fedId, crop) => { store.updateJudge(fedId, { crop: crop ? cleanCrop(crop) : null }); rebuild(); return rendererState(); });
  ipcMain.handle('judge-photo-remove', (_e, fedId) => { store.removePhoto(fedId); rebuild(); return rendererState(); });
  ipcMain.handle('open-url', (_e, url) => { if (/^https?:\/\/(localhost|127\.0\.0\.1|[\d.]+):\d+\//.test(url)) shell.openExternal(url); });
}

async function start() {
  store = new Store(app.getPath('userData'));
  server = new OutputServer({ outputsDir: path.join(__dirname, '..', 'outputs'), photoDir: store.photoDir });
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
  poller.wantedRounds = () => wantedRounds();
  poller.on('raw', (r) => { raw = r; rebuild(); });
  poller.on('status', (s) => { const changed = s.connected !== status.connected || s.error !== status.error; status = s; if (changed) publish(); else win?.webContents.send('status', s); });

  setupIpc();
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 640, backgroundColor: '#0f1115', title: 'Dance Projector',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });

  if (fixtureFile) { await loadEvents(); poller.start(); }
  else { dans = new DansClient(store.cfg.server); poller.setClient(dans); await loadEvents(); selectEvent(); poller.start(); }
  publish();
}

app.whenReady().then(start);
app.on('window-all-closed', () => { store?.flush(); server?.close(); poller?.stop(); app.quit(); });
