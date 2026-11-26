'use strict';
// Electron main process: owns the data, talks to DanS (read-only), serves the output pages and answers the
// operator window over IPC.
//
// Data flow:
//   DanS ──(poller: auto / on demand)──> raw ──> buildModel ──> applyPanels ──> outputState = draft
//   offline copy (cache/<event>.json) ──┘                                              │
//                                                       Push to projection ──> pushed ─┴─> output server ──> OBS
//
// Competitors (D-22) run beside it with their own output server (port 8788) and their own Push:
//   start list + stored entries (competitors.json) ──> competitorState = draft ──> Push competitors ──> OBS
//   phone upload page (same server, C-34) ──> photo of a start number
//
// The operator window never reaches DanS or the files itself; it asks this process through preload.js.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const QRCode = require('qrcode');
const { encodeImage, prepareForOcr, closeWorker } = require('./imagedecode');
const ocr = require('./ocr');
const { parsePrintout, mergeResults } = require('./printout');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { DansClient } = require('./dans');
const { Poller, FixturePoller, eventIdOf } = require('./poller');
const { buildModel } = require('./model');
const { Store, normalizeServer } = require('./store');
const { OutputServer } = require('./server');
const { Projection, COMPETITOR_SECTIONS } = require('./projection');
const { panelKey, applyPanels, togglePanel, toggleManual, cleanLetter, SORTS, moveInOrder } = require('./panels');
const { cleanTheme, themeFor, themeKey, PRESETS } = require('./theme');
const { outputState, judgeView, cleanCrop, slotJudges, competitorList, competitorState, resultsState } = require('./view');
const { resultsReady, placesFromDraw, placeGroups, clampStep } = require('./results');
const { heatPlan, RoundTracker } = require('./heattrack');
const { pickRoundId } = require('./roundpick');
const { sortForImport, mainPhoto } = require('./gallery');
const { numberKey, parseNumbers, drawNumbers, screenName, findByNumber, attachToDans } = require('./competitors');
const csts = require('./csts');

// Command-line options: --fixture=<file> plays back a saved event instead of DanS; --data=<folder> uses a
// separate settings folder (handy for testing next to the real instance).
const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const fixtureFile = arg('fixture');
// The data folder is always %APPDATA%\dance-projector, whether the app runs from `npm start` or as the built
// Dance Projector.exe (C-59). Electron would otherwise name the folder after the product name of the build
// ("Dance Projector") and the .exe would start with empty settings, no gallery and no offline copies.
app.setPath('userData', arg('data') ? path.resolve(arg('data')) : path.join(app.getPath('appData'), 'dance-projector'));

// Where the OBS brand pages (obs/pages) are, for the background in the app's preview. From the project they sit
// next to app/; the built .exe carries its own copy in resources/brand (see "extraResources" in package.json).
const BRAND_DIR = app.isPackaged ? path.join(process.resourcesPath, 'brand') : path.join(__dirname, '..', '..', '..', 'obs', 'pages');

let win, store, poller, server, dans, projection;
let compServer = null, compProjection = null, compAddr = null; // competitor projection (C-32)
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

// Every image is re-encoded as a plain baseline JPEG by imagedecode.js (Chromium's decoder in a hidden window):
// some phone JPEGs don't show in the OBS browser source otherwise, EXIF orientation gets applied, and files cut
// off at the end still import. ENCODER marks photos made this way; photos imported by older versions of the
// app lack it and are redone from the original when the same folder is imported again.
const ENCODER = 2;

// SHA-1 of a file's bytes. Identifies an original photo, so importing the same folder again skips it.
const fileHash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const tempJpeg = () => path.join(app.getPath('temp'), `dp-photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`);

// Adds one image file to a judge's gallery: re-encode, copy into photos/, remember its hash.
// Returns 'added', 'redone' (same original imported before by an older version: re-encoded in place, which
// fixes photos that came out rotated) or 'skipped' (already in the gallery).
async function addJudgePhoto(fedId, file, { makeMain = false } = {}) {
  const hash = fileHash(file);
  const known = store.photoByHash(fedId, hash);
  if (known && known.enc >= ENCODER) return 'skipped';
  const tmp = tempJpeg();
  try {
    await encodeImage(file, tmp);
    if (known) store.replacePhotoFile(fedId, known.file, tmp, { enc: ENCODER });
    else store.addPhoto(fedId, tmp, { hash, makeMain, enc: ENCODER });
  } finally { fs.rm(tmp, { force: true }, () => {}); }
  return known ? 'redone' : 'added';
}

// The same for an image that arrives as bytes: pasted with Ctrl+V on the Judges tab (D-28), like the competitor
// photos. The bytes go to a temporary file first, because the decoder reads files.
async function addJudgePhotoBytes(fedId, bytes, opts) {
  const tmp = path.join(app.getPath('temp'), `dp-in-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  try { return await addJudgePhoto(fedId, tmp, opts); } finally { fs.rm(tmp, { force: true }, () => {}); }
}

// Turns one stored photo by 90/180/270 degrees (Adjust photo window). The result is a new file, so the
// projection keeps showing the old one until the next push. The framing is reset, because it no longer fits.
// Returns the new file name.
async function rotateJudgePhoto(fedId, file, degrees) {
  const tmp = tempJpeg();
  try {
    // no downscaling: a portrait turned sideways is wider than the 900 px import limit and should stay sharp
    await encodeImage(path.join(store.photoDir, file), tmp, { maxWidth: 4000, rotate: degrees });
    return store.replacePhotoFile(fedId, file, tmp, { resetCrop: true });
  } finally { fs.rm(tmp, { force: true }, () => {}); }
}

// ---- competitor photos (C-35): same pipeline as judges. Competitors are addressed by key (competitors.js, C-37) ----

// Adds one image file to a competitor. Returns 'added' or 'skipped' (the same file is already there).
async function addCompetitorPhoto(key, file, { makeMain = false } = {}) {
  const hash = fileHash(file);
  if (store.hasCompetitorPhotoHash(key, hash)) return 'skipped';
  const tmp = tempJpeg();
  try {
    await encodeImage(file, tmp);
    store.addCompetitorPhoto(key, tmp, { hash, makeMain });
  } finally { fs.rm(tmp, { force: true }, () => {}); }
  rememberIdts(key);
  return 'added';
}
// The same for an image that arrives as bytes: pasted from the clipboard, taken with the webcam, or sent from the
// phone. The bytes go to a temporary file first, because the decoder reads files.
async function addCompetitorPhotoBytes(key, bytes, opts) {
  const tmp = path.join(app.getPath('temp'), `dp-in-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  try { return await addCompetitorPhoto(key, tmp, opts); } finally { fs.rm(tmp, { force: true }, () => {}); }
}
// Turns one competitor photo (Adjust photo window), like rotateJudgePhoto.
async function rotateCompetitorPhoto(key, file, degrees) {
  const tmp = tempJpeg();
  try {
    await encodeImage(path.join(store.photoDir, file), tmp, { maxWidth: 4000, rotate: degrees });
    return store.replaceCompetitorPhotoFile(key, file, tmp, { resetCrop: true });
  } finally { fs.rm(tmp, { force: true }, () => {}); }
}
// Notes the IDTs of a competitor with photos on its stored entry, so the other event of a two-day competition can
// find the photos by IDT (C-38). DanS names are not stored, only the IDTs.
function rememberIdts(key) {
  const c = competitorList(raw, store).find((x) => x.key === key);
  const idts = (c?.people || []).map((x) => x.idt).filter(Boolean);
  if (idts.length && store.competitor(key)) store.updateCompetitor(key, { idts });
}
// The competitor with a start number, or a new typed one for a number nobody has yet (a pasted photo or a phone
// photo for a number DanS hasn't given). Returns { key, created }.
function competitorForNumber(n, origin) {
  const found = findByNumber(competitorList(raw, store), n);
  if (found) return { key: found.key, created: false, found };
  const key = store.newManualKey();
  store.updateCompetitor(key, { number: n, origin });
  return { key, created: true, found: null };
}
// Typed entries that existed only for a number move onto the DanS competitor once it has that number – from DanS,
// or read from a printout (D-24).
function attachCompetitors() {
  if (!raw?.startlist) return;
  const numbered = new Map(competitorList(raw, store).filter((c) => c.inDans && c.number).map((c) => [c.key, c]));
  for (const m of attachToDans(numbered, store.storedCompetitors())) {
    store.moveCompetitor(m.from, m.to);
    rememberIdts(m.to);
  }
}

// "Novák – Dvořáková" / "Jana Nováková": how a competitor is named in the window, on the phone and in notices.
function competitorLabel(c) {
  if (!c) return '';
  if (c.kind === 'couple') return screenName(c).last;
  const p = c.people?.[0] || {};
  return `${p.name || ''} ${p.surname || ''}`.trim();
}

// ---- phone upload (C-34) ----
// Hooks for the competitor server's /upload routes (server.js handleUpload).
const phoneUpload = {
  enabled: () => !!store.cfg.phoneUpload?.enabled,
  key: () => store.cfg.phoneUpload?.key || '',
  page: path.join(__dirname, '..', 'phone', 'upload.html'),
  // only competitors with a number: the organizer types numbers
  list: () => competitorList(raw, store).filter((c) => c.number).map((c) => ({ number: Number(c.number), label: competitorLabel(c) })),
  // A photo from the phone becomes the main photo of that number. An unknown number still gets it: a competitor with
  // only the number is created (origin 'phone'), so nothing sent is lost; the operator fills in the names later.
  async receive(number, bytes) {
    const n = numberKey(number);
    if (!n) throw new Error('Missing or wrong start number');
    if (!bytes.length) throw new Error('The photo is empty');
    const { key, created, found: known } = competitorForNumber(n, 'phone');
    try { await addCompetitorPhotoBytes(key, bytes, { makeMain: true }); }
    catch (e) { if (created) store.deleteCompetitor(key); throw new Error(`The photo could not be read: ${e.message}`); }
    const label = competitorLabel(known);
    notify(`Photo from the phone for ${n}${label ? ' – ' + label : ' (new number)'}`, n);
    rebuild();
    return { number: Number(n), label };
  },
};
// A photo of a printout taken on the phone (D-24): read like a webcam shot; the review window opens in the app.
phoneUpload.printout = async (bytes) => {
  const r = await readPrintout(bytes);
  if (r.error) throw new Error(r.error);
  if (win && !win.isDestroyed()) win.webContents.send('printout', { ...r, image: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` });
  notify('Printout photo from the phone – check it in the window that opened');
  return { competitors: r.result.competitors.length, judges: r.result.judges.length };
};
const newUploadKey = () => crypto.randomBytes(12).toString('base64url');

// Short message in the window (e.g. "photo received"); number = competitor to highlight.
function notify(text, number = null) { if (win && !win.isDestroyed()) win.webContents.send('notice', { text, number, at: Date.now() }); }

// Imports a folder of photos named "IDT_Surname_Name[ Number].ext" (gallery.js parseFileName).
// New judges get the names from the file name; names already in the gallery are kept, because the operator
// may have corrected them. Returns a report for the window.
async function importGalleryFolder(dir) {
  const report = { added: 0, redone: 0, judges: new Set(), duplicates: 0, unrecognised: [], failed: [] };
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => ({ name: d.name }));
  for (const { f, info } of sortForImport(files)) {
    if (!info) { if (!f.name.startsWith('.')) report.unrecognised.push(f.name); continue; }
    try {
      store.ensureJudge(info.idt, { name: info.name, surname: info.surname });
      const result = await addJudgePhoto(info.idt, path.join(dir, f.name));
      if (result === 'added') { report.added++; report.judges.add(info.idt); }
      else if (result === 'redone') report.redone++;
      else report.duplicates++;
    } catch (e) { report.failed.push(`${f.name}: ${e.message}`); }
  }
  return { ...report, judges: report.judges.size, folder: dir };
}

// One-time conversion of photos imported before any re-encoding existed (originals kept in photos-original).
async function normalizeExistingPhotos() {
  for (const [fedId, j] of store.galleryEntries()) {
    if (j.normalized !== undefined || !j.photos?.length) continue; // everything imported since is re-encoded
    const keep = path.join(store.dir, 'photos-original');
    try {
      fs.mkdirSync(keep, { recursive: true });
      for (const p of j.photos) {
        const file = path.join(store.photoDir, p.file);
        if (!fs.existsSync(path.join(keep, p.file))) fs.copyFileSync(file, path.join(keep, p.file));
        await encodeImage(file, file + '.tmp'); fs.renameSync(file + '.tmp', file);
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
  try { events = await dans.events(); if (!status.connected) status = { connected: true, error: null, lastOk: Date.now() }; eventEnds(); }
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

// "Follow running": a slot with follow on takes over a NEWLY running competition when its own isn't running.
// Only competitions that started running since the last rebuild count. Before, every rebuild looked at all running
// competitions, so a competition picked by hand (not running) was replaced straight back by the running one and
// the operator could never choose anything else while a round was in progress (C-46).
let followSeen = { eventId: undefined, running: new Set() }; // competitions already running at the last rebuild
function applyFollow() {
  if (!model) return false;
  // what is running now, and which of those were not running last time (all of them after an event change)
  const running = new Set(model.competitions.filter((c) => c.running).map((c) => c.id));
  const seen = followSeen.eventId === store.cfg.eventId ? followSeen.running : new Set();
  const started = new Set([...running].filter((id) => !seen.has(id)));
  followSeen = { eventId: store.cfg.eventId, running };
  if (!started.size) return false;
  let changed = false;
  for (const key of store.cfg.split ? ['A', 'B'] : ['A']) {
    const s = store.cfg.slots[key];
    if (!s.follow || s.source === 'manual') continue; // an own selection is never replaced automatically
    const other = store.cfg.slots[key === 'A' ? 'B' : 'A'].competitionId;
    const mine = model.competitions.find((c) => c.id === s.competitionId);
    if (mine?.running) continue;
    const cand = model.competitions.filter((c) => started.has(c.id) && c.id !== other)
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
  attachCompetitors();
  applyFollow();
  updateHeats();
  publish();
}

// ---------------------------------------------------------------------------------------------------------
// Heats: which heat is on the floor and which is next (D-29, heattrack.js)
// ---------------------------------------------------------------------------------------------------------

const trackers = new Map();    // round id -> RoundTracker; kept while the app runs, so Next / Back survive a pause
const LIVE_MAX_AGE = 30000;    // marks older than this are not "live" any more (DanS stopped answering, mode changed)

// Rounds being danced now: the current round of every competition whose round is in a running state. The poller
// reads their marks in automatic mode (poller.liveRounds).
function liveRoundIds(r) {
  const states = store.cfg.runningStates?.length ? store.cfg.runningStates : ['InProgress'];
  return (r?.competitions || []).map((c) => {
    const rd = (c.rounds || []).find((x) => x.id === pickRoundId(c));
    return rd && states.includes(rd.state) ? rd.id : null;
  }).filter(Boolean);
}

// Dance lookup id -> { abbr, name } for the heat plan
function danceNames() {
  const m = new Map((raw?.indexes?.dance || []).map((d) => [d.id, { abbr: d.abbreviation || d.value, name: d.value }]));
  return (id) => m.get(id) || {};
}

// Feeds every running round's tracker with the latest DanS data. Marks count only when they are live: read in
// automatic mode within the last 30 s. Without them the tracker still follows the dances DanS marks finished, and
// the operator's Next heat / Back.
function updateHeats() {
  const names = danceNames();
  for (const rid of liveRoundIds(raw)) {
    const rc = raw.competitions.find((c) => (c.rounds || []).some((x) => x.id === rid));
    const round = rc.rounds.find((x) => x.id === rid);
    const live = raw.live?.[rid];
    const fresh = !!live && mode() === 'auto' && Date.now() - live.at < LIVE_MAX_AGE;
    if (!trackers.has(rid)) trackers.set(rid, new RoundTracker(rid));
    const t = trackers.get(rid);
    t.update(heatPlan(round, raw.draws?.[rid], names), round, fresh ? live.marks : null, fresh ? live.at : Date.now());
    if (fresh) logHeats(rid, rc, round, live);
  }
}

// The heat log (D-29): one line per poll in which something changed in a running round – marks added or taken back,
// dances submitted, the judges' tablets moving – and where the tracker put the round. Kept in the app's data folder
// (heatlog/<date>.jsonl, real data, never in the repository) to check at an event how live the marks really are and
// to tune the margin of error. scripts/heatlog.js prints it as a timeline.
const heatLogSeen = new Map(); // round id -> { at, marks: Map key -> value, tablets: string }
function logHeats(rid, rc, round, live) {
  const prev = heatLogSeen.get(rid) || { at: 0, marks: new Map(), tablets: '' };
  if (prev.at === live.at) return; // this read is logged already (rebuild runs for many reasons)
  const t = trackers.get(rid);
  const plan = t.plan;
  const letter = new Map([...(model?.judges.values() || [])].map((j) => [j.personId, j.letter]));
  // where a competitor dances: round dance + competitor id -> dance, heat, number
  const where = new Map();
  plan.dances.forEach((dn) => dn.heats.forEach((ht) => ht.competitors.forEach((c) => where.set(`${dn.id}|${c.id}`, { dance: dn.abbr, heat: ht.heat, number: c.number }))));
  const danceAbbr = new Map(plan.dances.map((dn) => [dn.id, dn.abbr]));
  // every mark as key -> value; the key says what the mark is about
  const marks = new Map();
  for (const m of live.marks || []) {
    const tc = m.target?.Competitor, td = m.target?.DanceCompletion, tr = m.target?.RoundCompletion;
    const key = tc ? `c|${tc.round_dance_id}|${tc.competitor_id}|${tc.judge}` : td ? `d|${td.round_dance_id}|${td.judge}` : tr ? `r|${tr.judge}` : null;
    if (key) marks.set(key, JSON.stringify(m.value) + (m.suppressed ? ' suppressed' : ''));
  }
  const describe = (key, value) => {
    const [kind, a, b, c] = key.split('|');
    if (kind === 'c') return { judge: c, ...(where.get(`${a}|${b}`) || { dance: danceAbbr.get(a) || '?', heat: null, number: null }), value };
    if (kind === 'd') return { judge: b, submitted: danceAbbr.get(a) || '?', value };
    return { judge: a, roundDone: true, value };
  };
  const changed = [];
  for (const [k, v] of marks) if (prev.marks.get(k) !== v) changed.push(describe(k, v));
  const removed = [...prev.marks.keys()].filter((k) => !marks.has(k)).map((k) => describe(k, 'removed'));
  // each judge's tablet: letter, the dance it is on, the assessment state
  const tablets = (round.judges || []).map((j) => `${letter.get(j.person) || '?'}:${danceAbbr.get(j.round_dance) || '-'}:${j.assessment_state}`).join(' ');
  const first = !prev.at;
  heatLogSeen.set(rid, { at: live.at, marks, tablets });
  if (!first && !changed.length && !removed.length && tablets === prev.tablets) return;
  const v = t.view();
  const line = {
    t: new Date(live.at).toISOString(), competition: rc.competition_number, round: round.abbreviation,
    first: first || undefined, // the first read of a round lists how many marks there were, not each one
    changed: first ? changed.length : changed, removed, tablets,
    dancesFinished: plan.dances.filter((dn) => dn.completed).map((dn) => dn.abbr).join(' '),
    now: v.now && `${v.now.dance} heat ${v.now.heat}`, next: v.next ? `${v.next.dance} heat ${v.next.heat}` : 'end of round',
    source: v.source, reason: v.reason,
  };
  try {
    const dir = path.join(store.dir, 'heatlog');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${new Date(live.at).toISOString().slice(0, 10)}.jsonl`), JSON.stringify(line) + '\n');
  } catch { /* the log is a help, never a reason to stop */ }
}

// The Heats tab and the floor boxes in the side panel: every running round with its heats, now and next.
function heatsWindowState() {
  const sides = store.cfg.split ? ['A', 'B'] : ['A'];
  const slotOf = (compId) => sides.find((k) => store.cfg.slots[k].source !== 'manual' && store.cfg.slots[k].competitionId === compId) || null;
  const rounds = liveRoundIds(raw).map((rid) => {
    const v = trackers.get(rid)?.view();
    const c = model?.competitions.find((x) => x.round?.id === rid);
    if (!v || !c) return null;
    return { ...v, competitionId: c.id, number: c.number, title: c.title, roundName: c.round.name, slot: slotOf(c.id) };
  }).filter(Boolean).sort((a, b) => (a.slot || 'Z').localeCompare(b.slot || 'Z') || a.number - b.number);
  return { live: mode() === 'auto', rounds };
}

// ---------------------------------------------------------------------------------------------------------
// State for the operator window
// ---------------------------------------------------------------------------------------------------------

function rendererState() {
  const slotIds = Object.values(store.cfg.slots).map((s) => s.competitionId);
  // judges on screen: DanS person ids of competitions in a slot, and IDTs of the own selections in use
  const inSlots = new Set();
  model?.competitions.filter((c) => slotIds.includes(c.id)).forEach((c) => c.judges.forEach((j) => inSlots.add(j.personId)));
  const manualOnScreen = new Set();
  for (const k of store.cfg.split ? ['A', 'B'] : ['A']) {
    if (store.cfg.slots[k].source === 'manual') for (const j of store.cfg.manualPanels?.[k]?.judges || []) manualOnScreen.add(j.fedId);
  }
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
    gallery: galleryView(base, inSlots, manualOnScreen),
    theme: { ...theme, imageUrl: theme.image && base ? `${base}/media/${encodeURIComponent(theme.image)}` : null },
    // judges of each side in the order the screen shows them (Judge selection tab, "Order on screen")
    screenOrder: Object.fromEntries(['A', 'B'].map((k) => [k, slotJudges(k, model, store).map(({ fedId, view }) => ({
      fedId, name: view.name, letter: view.letter, photo: view.photo && base ? base + view.photo : null, crop: view.crop,
    }))])),
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name, theme: p.theme })),
    projection: { auto: projection.auto, changes: projection.changes(), pushedAt: projection.pushedAt },
    // ---- competitors (D-22) ----
    competitors: competitorList(raw, store).map((c) => ({
      ...c, label: competitorLabel(c), main: mainPhoto(c)?.file || null,
      photos: c.photos.map((p) => ({ file: p.file, url: base ? `${base}/photos/${encodeURIComponent(p.file)}` : null, crop: cleanCrop(p.crop) })),
    })),
    competitorScreen: store.cfg.competitorScreen,
    lastPurge,
    results: resultsWindowState(base),
    heats: heatsWindowState(),
    compProjection: compProjection ? { changes: compProjection.changes(), pushedAt: compProjection.pushedAt } : null,
    upload: {
      enabled: !!store.cfg.phoneUpload?.enabled,
      // one address per network the laptop is on; the window lets the operator pick the one the phone shares
      urls: compAddr && store.cfg.phoneUpload?.key ? lanAddresses().map((ip) => `http://${ip}:${compAddr.port}/upload?key=${store.cfg.phoneUpload.key}`) : [],
    },
    webcamId: store.cfg.webcamId || null,
    printoutRotate: store.cfg.printoutRotate || 0,
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
        // the competitor projection lives on its own port (C-32)
        ...(compAddr ? [{ name: `Competitors (port ${compAddr.port})`, path: '/out/competitors.html', port: compAddr.port },
          // results announcement (D-26): same server, so it has the competitor photos and its own pushed state
          { name: `Results (port ${compAddr.port})`, path: '/out/results.html', port: compAddr.port }] : []),
      ],
    } : null,
  };
}

// The Results tab (D-26): every competition with a final and whether its places can be read yet, what is chosen,
// and the ladder with names for the operator (all places, revealed or not, so they can read ahead).
function resultsWindowState(base) {
  const r = store.cfg.results;
  const competitions = (raw?.competitions || []).map((rc) => {
    const c = model?.competitions.find((x) => x.id === rc.id);
    const ready = resultsReady(rc);
    return {
      id: rc.id, number: rc.competition_number, title: c?.title || '', state: rc.state,
      ready: ready.ok, reason: ready.reason, finalId: ready.final?.id || null, finalName: ready.final?.name || '',
      loaded: !!(ready.final && raw?.results?.[ready.final.id]),
    };
  }).sort((a, b) => a.number - b.number);
  const list = competitorList(raw, store);
  const view = resultsState(model, raw, store, list);
  // the operator sees every place, also the ones not revealed yet: the same ladder with everything revealed
  const all = view ? resultsState(model, raw, store, list, { step: Infinity }) : null;
  const photo = (p) => (p && base ? base + p : null); // both output servers serve the same photos folder
  return {
    ...r, competitions,
    total: view?.total || 0, step: view?.step || 0, done: !!view?.done,
    rows: (all?.rows || []).map((row, i) => ({
      label: row.label, revealed: !!view.rows[i]?.revealed,
      competitors: row.competitors.map((c) => ({ number: c.number, name: [c.first, c.last].filter(Boolean).join(' ') || c.surnames.join(' – '), club: c.club, sponsor: c.sponsor, photo: photo(c.photo), crop: c.crop })),
    })),
  };
}

// The Judges tab: every judge in the gallery plus every judge of the current event (even without a gallery
// entry yet), with all photos. DanS names are shown as hints next to the editable gallery names.
function galleryView(base, inSlots, manualOnScreen = new Set()) {
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
    letter: dans?.letter || '', inEvent: !!dans, inSlots: (!!dans && inSlots.has(dans.personId)) || manualOnScreen.has(fedId),
    main: mainPhoto(g)?.file || null,
    photos: (g.photos || []).map((p) => ({ file: p.file, url: url(p.file), crop: cleanCrop(p.crop) })),
  })).sort((a, b) => (a.surname || a.dansSurname).localeCompare(b.surname || b.dansSurname, 'cs'));
}

// Recomputes the draft and sends the window a new state. Status-only changes go as a lighter 'status' message.
let lastRendererJson = '';
function publish() {
  projection?.setDraft(outputState(model, raw || {}, store, status));
  compProjection?.setDraft(competitorState(model, raw, store));
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
    // a new event: nothing of the old one stays chosen (the results announcement starts empty too)
    store.updateConfig({ eventId: id, slots: { A: { competitionId: null }, B: { competitionId: null } }, results: { competitionId: null, roundId: null, step: 0 } });
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
    cleanupFiles(); // photos replaced since the last push can go now
    publish(); return rendererState();
  });
  ipcMain.handle('push-competitors', () => { compProjection?.push(); cleanupFiles(); publish(); return rendererState(); });
  // "Send every change automatically" covers both projections
  ipcMain.handle('set-projection-auto', (_e, on) => {
    store.updateConfig({ projectionAuto: !!on }); projection.setAuto(!!on); compProjection?.setAuto(!!on);
    publish(); return rendererState();
  });

  // ---- slots (which competition is on screen) ----
  ipcMain.handle('assign', (_e, slot, compId) => {
    const s = store.cfg.slots[slot]; if (!s) return rendererState();
    const other = store.cfg.slots[slot === 'A' ? 'B' : 'A'];
    s.competitionId = s.competitionId === compId ? null : compId;
    if (s.competitionId && other.competitionId === compId) other.competitionId = null;
    if (s.competitionId) s.source = 'dans'; // pressing Show on a DanS competition switches this side back to DanS
    store.config.save(); rebuild(); return rendererState();
  });
  ipcMain.handle('set-slot', (_e, slot, patch) => {
    const allowed = {};
    for (const k of ['label', 'labelEn', 'color', 'follow']) if (k in patch) allowed[k] = patch[k];
    store.updateConfig({ slots: { [slot]: allowed } }); rebuild(); return rendererState();
  });

  const validSlot = (slot) => slot === 'A' || slot === 'B';
  // ---- order of the judge cards on screen (panels.js sortJudges) ----
  // Switching to 'custom' starts from the order the screen shows right now, so nothing jumps; an existing
  // custom order is kept when it already covers every judge of the side.
  ipcMain.handle('set-judge-sort', (_e, slot, mode) => {
    if (!validSlot(slot) || !SORTS.includes(mode)) return rendererState();
    const patch = { judgeSort: mode };
    if (mode === 'custom') {
      const shown = slotJudges(slot, model, store).map((x) => x.fedId);
      const kept = store.cfg.slots[slot].order || [];
      if (!shown.every((id) => kept.includes(id))) patch.order = shown;
    }
    store.updateConfig({ slots: { [slot]: patch } }); rebuild(); return rendererState();
  });
  // ↑ / ↓ next to a judge: moves them one place and switches the side to the custom order
  ipcMain.handle('judge-move', (_e, slot, fedId, delta) => {
    if (!validSlot(slot) || ![-1, 1].includes(delta)) return rendererState();
    const shown = slotJudges(slot, model, store).map((x) => x.fedId);
    store.updateConfig({ slots: { [slot]: { judgeSort: 'custom', order: moveInOrder(shown, String(fedId), delta) } } });
    rebuild(); return rendererState();
  });

  // ---- judge panels (panels.js) ----
  const comp = (id) => model?.competitions.find((c) => c.id === id);
  ipcMain.handle('panel-toggle', (_e, compId, personId) => {
    const c = comp(compId); if (!c) return rendererState();
    const current = store.panelOverrides(store.cfg.eventId)[panelKey(c)];
    store.setPanel(store.cfg.eventId, panelKey(c), togglePanel(current, c.dansJudges.map((j) => j.personId), personId));
    rebuild(); return rendererState();
  });
  // the window names the competition; the override belongs to its current round (panelKey, C-47)
  ipcMain.handle('panel-reset', (_e, compId) => { const c = comp(compId); if (c) store.setPanel(store.cfg.eventId, panelKey(c), null); rebuild(); return rendererState(); });
  ipcMain.handle('panel-clear', (_e, compId) => { const c = comp(compId); if (c) store.setPanel(store.cfg.eventId, panelKey(c), []); rebuild(); return rendererState(); });

  // ---- own selections without DanS (D-19, view.js manualCompetition) ----
  const manual = (slot) => (store.cfg.manualPanels[slot] ||= { judges: [] });
  // which source a side shows: 'dans' (competition from the list) or 'manual' (own selection)
  ipcMain.handle('set-slot-source', (_e, slot, source) => {
    if (validSlot(slot) && ['dans', 'manual'].includes(source)) store.updateConfig({ slots: { [slot]: { source } } });
    rebuild(); return rendererState();
  });
  // competition details typed by hand; all optional, empty text removes the field
  ipcMain.handle('manual-update', (_e, slot, patch) => {
    if (!validSlot(slot)) return rendererState();
    const m = manual(slot);
    for (const k of ['number', 'title', 'titleEn', 'round']) {
      if (!(k in patch)) continue;
      const v = String(patch[k] ?? '').trim().slice(0, 120);
      if (v) m[k] = v; else delete m[k];
    }
    store.config.save(); rebuild(); return rendererState();
  });
  ipcMain.handle('manual-toggle', (_e, slot, fedId) => {
    if (!validSlot(slot) || !fedId) return rendererState();
    manual(slot).judges = toggleManual(manual(slot).judges, String(fedId));
    store.config.save(); rebuild(); return rendererState();
  });
  ipcMain.handle('manual-letter', (_e, slot, fedId, letter) => {
    if (!validSlot(slot)) return rendererState();
    const l = cleanLetter(letter);
    manual(slot).judges = manual(slot).judges.map((j) => (j.fedId === fedId && l ? { ...j, letter: l } : j));
    store.config.save(); rebuild(); return rendererState();
  });
  ipcMain.handle('manual-clear', (_e, slot) => {
    if (validSlot(slot)) { manual(slot).judges = []; store.config.save(); }
    rebuild(); return rendererState();
  });

  // ---- style of the current event (theme.js) ----
  const setTheme = (patch) => store.updateConfig({ themes: { [themeKey(store.cfg.eventId)]: cleanTheme(patch) } });
  ipcMain.handle('set-theme', (_e, patch) => { setTheme(patch); rebuild(); return rendererState(); });
  // ready-made style (theme.js PRESETS), e.g. the MČR event colours
  ipcMain.handle('theme-preset', (_e, id) => { if (PRESETS[id]) setTheme(PRESETS[id].theme); rebuild(); return rendererState(); });
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
      await encodeImage(file, path.join(store.mediaDir, name), { maxWidth: 1920 }); // full HD is all the projection needs
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
    if (patch.competitorKeepDays != null) {
      const d = Math.round(Number(patch.competitorKeepDays));
      if (d >= 1 && d <= 30) allowed.competitorKeepDays = d;
    }
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
    for (const [i, f] of files.entries()) {
      try { await addJudgePhoto(fedId, f, { makeMain: makeMain && i === 0 }); } catch (e) { failed.push(`${path.basename(f)}: ${e.message}`); }
    }
    if (failed.length) dialog.showErrorBox('Judge photos', `These files could not be used:\n${failed.join('\n')}`);
    rebuild(); return rendererState();
  });
  // An image pasted with Ctrl+V onto the selected judge card (D-28); it becomes the judge's main photo.
  ipcMain.handle('judge-photo-bytes', async (_e, fedId, bytes) => {
    fedId = String(fedId || '').trim();
    if (!/^\d{3,}$/.test(fedId)) return { ...rendererState(), error: 'Choose a judge first.' };
    store.ensureJudge(fedId);
    try { await addJudgePhotoBytes(fedId, bytes, { makeMain: true }); }
    catch (e) { rebuild(); return { ...rendererState(), error: `The image could not be used: ${e.message}` }; }
    rebuild(); return rendererState();
  });
  ipcMain.handle('judge-photo-main', (_e, fedId, file) => { store.setMainPhoto(fedId, file); rebuild(); return rendererState(); });
  ipcMain.handle('judge-photo-delete', (_e, fedId, file) => { store.deletePhoto(fedId, file); rebuild(); return rendererState(); });
  // Delete a whole judge from the gallery (the window asks for confirmation first)
  ipcMain.handle('judge-delete', (_e, fedId) => { if (fedId) store.deleteJudge(String(fedId)); rebuild(); return rendererState(); });
  // Turn a photo by ±90 degrees from the Adjust photo window. Returns the new state and the new file name,
  // so the open window can switch to the turned photo.
  ipcMain.handle('judge-photo-rotate', async (_e, fedId, file, degrees) => {
    let newFile = null;
    try { newFile = await rotateJudgePhoto(fedId, file, [90, -90, 180].includes(degrees) ? degrees : 90); }
    catch (e) { dialog.showErrorBox('Rotate photo', `The photo could not be turned: ${e.message}`); }
    rebuild(); return { state: rendererState(), file: newFile };
  });
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
    const report = await importGalleryFolder(dir);
    rebuild();
    return { state: rendererState(), report };
  });

  setupCompetitorIpc();
  setupResultsIpc();
  setupHeatsIpc();
  setupPrintoutIpc();
  setupPrintoutApplyIpc();

  // Opens an output page in the normal browser; only addresses of our own output server.
  ipcMain.handle('open-url', (_e, url) => { if (/^https?:\/\/(localhost|127\.0\.0\.1|[\d.]+):\d+\//.test(url)) shell.openExternal(url); });
}

// Removes photo and image files nothing uses, keeping whatever either projection still shows.
// ---------------------------------------------------------------------------------------------------------
// Competitor photos are not kept (D-30): children's photos go a few days after their event
// ---------------------------------------------------------------------------------------------------------

// When each event's last day ends (ms), from the DanS event list and the offline copies: date + days. The key is the
// event id, as competitors.json uses it. Unknown events give null (then only the age of each photo counts).
function eventEnds() {
  const ends = new Map();
  const add = (id, date, days) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
    if (!id || !m) return;
    // midnight after the last day, local time
    const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.max(1, Number(days) || 1)).getTime();
    ends.set(id, Math.max(ends.get(id) || 0, end));
  };
  for (const e of store.listSnapshots()) add(e.id, e.date, e.days);
  for (const e of events) add(eventIdOf(e), e.date ?? e.authorities?.[0]?.date, e.authorities?.[0]?.days);
  // remembered from earlier runs: an event no longer listed (offline, or removed from DanS) still has its date
  const known = { ...(store.cfg.eventEnds || {}) };
  for (const [id, t] of Object.entries(known)) if (!ends.has(id)) ends.set(id, t);
  // remember the events that have stored competitors, so their photos can go even once DanS no longer lists them
  let changed = false;
  for (const id of Object.keys(store.competitors.data)) {
    if (ends.has(id) && known[id] !== ends.get(id)) { known[id] = ends.get(id); changed = true; }
  }
  if (changed) store.updateConfig({ eventEnds: known });
  return ends;
}

// Deletes what Dance Projector collected about past events once it is older than the setting allows (D-30):
// competitor photos and, after the event, everything typed about its competitors (C-57); the app's offline copies of
// DanS data and its heat logs (C-58). Never DanS's own data. Photo files go with cleanupFiles(), except a photo still
// on screen, which goes after the next push. Runs at start and every hour.
let lastPurge = null; // { at, photos, competitors, offline, heatlogs } of the last run that removed something
function purgeOldData() {
  const ends = eventEnds();
  const days = store.cfg.competitorKeepDays || 3;
  const eventEnd = (k) => ends.get(k) ?? null;
  const r = { ...store.purgeCompetitors({ days, eventEnd }), ...store.purgeCollected({ days, eventEnd, keepEvent: store.cfg.eventId }) };
  if (Object.values(r).some(Boolean)) {
    lastPurge = { at: Date.now(), ...r };
    cleanupFiles();
    if (r.offline && mode() === 'manual') loadEvents().then(publish); // Manual mode lists the offline copies
    rebuild();
  }
}

function cleanupFiles() {
  const keep = projection.referencedFiles();
  for (const f of compProjection?.referencedFiles() || []) keep.add(f);
  store.cleanupFiles(keep);
}

// ---------------------------------------------------------------------------------------------------------
// IPC: Results tab (D-26)
// ---------------------------------------------------------------------------------------------------------
// Choosing and loading only change the prepared state (Push competitors, or the first Reveal, puts it on screen).
// Reveal / Back / Hide all go on screen at once: the announcer is speaking, there is no time for a second button.
// Only the results part is pushed then (Projection.pushKeys), so competitor-screen edits in preparation stay off air.

function setupResultsIpc() {
  const cfg = () => store.cfg.results;
  const withError = (error) => ({ ...rendererState(), error });
  const rawComp = (id) => (raw?.competitions || []).find((c) => c.id === id) || null;
  // how many place groups the loaded results have in the chosen scope (Top 3 / whole final)
  const groupCount = () => {
    const draw = cfg().roundId ? raw?.results?.[cfg().roundId] : null;
    return draw ? placeGroups(placesFromDraw(draw), cfg().scope).length : 0;
  };
  const reveal = () => { publish(); compProjection?.pushKeys(['results']); cleanupFiles(); publish(); };

  // patch: { competitionId } picks a competition (results already read for its final are used straight away);
  // { scope: 'top3' | 'all' } how many are announced. Both start the announcement from the beginning.
  ipcMain.handle('results-set', (_e, patch) => {
    const r = cfg();
    if ('competitionId' in patch) {
      r.competitionId = patch.competitionId || null;
      const ready = resultsReady(rawComp(r.competitionId));
      r.roundId = ready.final && raw?.results?.[ready.final.id] ? ready.final.id : null;
      r.step = 0;
    }
    if (patch.scope === 'top3' || patch.scope === 'all') { r.scope = patch.scope; r.step = 0; }
    store.config.save(); rebuild(); return rendererState();
  });

  // Reads the places of the competition's final from DanS (2 GET requests: start list + the final's draw). Manual
  // mode never contacts DanS: it uses the final as kept in the offline copy, when it was read before.
  ipcMain.handle('results-load', async (_e, compId) => {
    const rc = rawComp(compId);
    if (!rc) return withError('Choose a competition first');
    const ready = resultsReady(rc);
    if (!ready.ok) return withError(`${ready.reason}. The places can be read once the final is finished.`);
    let draw;
    if (mode() === 'manual') {
      draw = raw?.results?.[ready.final.id];
      if (!draw) return withError('Manual mode never contacts DanS, and this final was not read before. Switch to On demand and load it.');
    } else {
      try { draw = await poller.fetchResults(ready.final.id); }
      catch (e) { status = poller.status; publish(); return withError(`Could not read the results from DanS: ${e.message}`); }
      if (poller.status) status = poller.status;
    }
    if (!placesFromDraw(draw).length) return withError('DanS has no places in this final yet.');
    Object.assign(cfg(), { competitionId: rc.id, roundId: ready.final.id, step: 0 });
    store.config.save(); rebuild(); return rendererState();
  });

  // { delta: +1 | -1 } reveals the next place / takes the last one back; { step: n } jumps (0 = hide all,
  // Infinity = reveal everything). Goes on screen straight away.
  ipcMain.handle('results-step', (_e, { delta, step } = {}) => {
    const n = groupCount();
    if (!n) return withError('Load the results first');
    const next = step != null ? (step === 'all' ? n : step) : cfg().step + (delta || 0);
    cfg().step = clampStep(next, n);
    store.config.save(); reveal(); return rendererState();
  });
}

// Heats tab (D-29): the operator moves a round's position by hand, or switches following the marks off / on.
// Nothing here reaches the projection: it is information for the operator.
function setupHeatsIpc() {
  ipcMain.handle('heat-move', (_e, roundId, dir) => {
    const t = trackers.get(roundId);
    if (t && (dir === 1 || dir === -1)) t.move(dir);
    publish(); return rendererState();
  });
  ipcMain.handle('heat-auto', (_e, roundId, on) => {
    trackers.get(roundId)?.setAuto(on);
    publish(); return rendererState();
  });
}

// ---------------------------------------------------------------------------------------------------------
// IPC: Competitors tab (D-22, C-31 to C-36)
// ---------------------------------------------------------------------------------------------------------

function setupCompetitorIpc() {
  const screen = () => store.cfg.competitorScreen;
  const withError = (error) => ({ ...rendererState(), error });
  // competitors are addressed by key ('dans:<id>' / 'm:<id>', competitors.js); anything else is refused
  const validKey = (k) => typeof k === 'string' && /^(dans|m):[\w-]{1,64}$/.test(k);
  const list = () => competitorList(raw, store);
  // another competitor (not `exceptKey`) already has this number
  const numberTaken = (n, exceptKey = null) => list().some((c) => c.number === n && c.key !== exceptKey);

  // ---- what the competitor screen shows ----
  // patch fields: competitionId, number, title, titleEn, round (typed header), numbers (text as typed), mode, spotlight
  ipcMain.handle('comp-screen', (_e, patch) => {
    const scr = screen();
    if ('competitionId' in patch) {
      scr.competitionId = patch.competitionId || null;
      // choosing a DanS competition means its header: forget what was typed before (it would override it)
      if (scr.competitionId) for (const k of ['number', 'title', 'titleEn', 'round']) delete scr[k];
      // numbers loaded from another competition's round no longer belong to this header: forget where they came from
      if (scr.roundId && !model?.competitions.some((c) => c.id === scr.competitionId && c.round?.id === scr.roundId)) { scr.roundId = null; scr.roundName = ''; }
    }
    for (const k of ['number', 'title', 'titleEn', 'round']) {
      if (!(k in patch)) continue;
      const v = String(patch[k] ?? '').trim().slice(0, 120);
      if (v) scr[k] = v; else delete scr[k];
    }
    let invalid = [];
    if ('numbers' in patch) { const r = parseNumbers(patch.numbers); scr.numbers = r.numbers; invalid = r.invalid; }
    if (patch.mode === 'round' || patch.mode === 'spotlight') scr.mode = patch.mode;
    if ('spotlight' in patch) scr.spotlight = numberKey(patch.spotlight);
    store.config.save(); rebuild();
    return invalid.length ? withError(`Ignored, not start numbers: ${invalid.join(', ')}`) : rendererState();
  });
  // adds a number to the round or takes it out (the "In round" switch on a competitor card)
  ipcMain.handle('comp-in-round', (_e, number, on) => {
    const n = numberKey(number), scr = screen();
    if (n) scr.numbers = on ? [...new Set([...(scr.numbers || []), n])] : (scr.numbers || []).filter((x) => x !== n);
    store.config.save(); rebuild(); return rendererState();
  });
  // Load from DanS round: the competition's current round (the latest one, e.g. the final once it exists).
  // Manual mode never contacts DanS and uses the round's draw from the offline copy, if it was read before.
  ipcMain.handle('comp-load-round', async (_e, compId) => {
    const c = model?.competitions.find((x) => x.id === compId);
    if (!c) return withError('Choose a DanS competition first');
    if (!c.round) return withError('This competition has no round in DanS yet');
    let draw;
    if (mode() === 'manual') {
      draw = raw?.draws?.[c.round.id];
      if (!draw) return withError(`No offline copy of ${c.round.name}. Load it once in On demand mode, or type the numbers.`);
    } else {
      try { draw = await poller.fetchRoundCompetitors(c.round.id); }
      catch (e) { status = poller.status; publish(); return withError(`Could not read the round from DanS: ${e.message}`); }
      if (poller.status) status = poller.status;
    }
    const numbers = drawNumbers(draw);
    if (!numbers.length) return withError(`DanS has no start numbers in ${c.round.name} yet`);
    // the header now comes from DanS too: a header typed earlier would override it, so it goes
    for (const k of ['number', 'title', 'titleEn', 'round']) delete screen()[k];
    Object.assign(screen(), { competitionId: c.id, roundId: c.round.id, roundName: c.round.name, numbers });
    store.config.save(); rebuild(); return rendererState();
  });
  // Refresh start list (1 GET): picks up start numbers once competition staff give them in DanS (D-23)
  ipcMain.handle('comp-refresh-startlist', async () => {
    if (mode() === 'manual') return withError('Manual mode never contacts DanS. Switch to On demand to read the start list.');
    try { await poller.fetchStartlist(); }
    catch (e) { status = poller.status; publish(); return withError(`Could not read the start list from DanS: ${e.message}`); }
    if (poller.status) status = poller.status;
    rebuild(); return rendererState();
  });

  // ---- the competitor list ----
  // New competitor typed by hand: number (optional), kind and people [{ name, surname, idt }]
  ipcMain.handle('comp-create', (_e, { number, kind, people }) => {
    const typed = String(number ?? '').trim();
    const n = numberKey(typed);
    if (typed && !n) return withError('The start number must be a number from 1 to 9999, or empty.');
    if (n && numberTaken(n)) return withError(`Number ${n} already exists. Edit it in the list.`);
    store.updateCompetitor(store.newManualKey(), { number: n, kind: kind === 'couple' ? 'couple' : 'solo', people: cleanPeople(people), origin: 'manual' });
    rebuild(); return rendererState();
  });
  // Edits: kind, people (the whole list, as the window shows it), club; number only for typed competitors (a DanS
  // competitor's number comes from DanS only, D-23)
  ipcMain.handle('comp-update', (_e, key, patch) => {
    if (!validKey(key)) return rendererState();
    const clean = {};
    if (patch.kind === 'solo' || patch.kind === 'couple') clean.kind = patch.kind;
    if (Array.isArray(patch.people)) clean.people = cleanPeople(patch.people);
    if ('club' in patch) clean.club = String(patch.club || '').trim().slice(0, 120);
    if ('sponsor' in patch) clean.sponsor = String(patch.sponsor || '').trim().slice(0, 120); // D-27
    if ('number' in patch && key.startsWith('m:')) {
      const typed = String(patch.number ?? '').trim(), n = numberKey(typed);
      if (typed && !n) return withError('The start number must be a number from 1 to 9999, or empty.');
      if (n && numberTaken(n, key)) return withError(`Number ${n} is already used by another competitor.`);
      clean.number = n;
    }
    store.updateCompetitor(key, clean);
    if (clean.people) rememberIdts(key);
    rebuild(); return rendererState();
  });
  // Forget what the app keeps for a competitor (names typed, photos). A DanS competitor stays listed from DanS; a
  // typed one disappears, and its number leaves the round unless someone else has it.
  ipcMain.handle('comp-delete', (_e, key) => {
    if (!validKey(key)) return rendererState();
    const n = list().find((c) => c.key === key)?.number;
    store.deleteCompetitor(key);
    if (n && !list().some((c) => c.number === n)) { screen().numbers = (screen().numbers || []).filter((x) => x !== n); store.config.save(); }
    rebuild(); return rendererState();
  });

  // ---- photos ----
  const imageFilter = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }];
  ipcMain.handle('comp-photos-add', async (_e, key, filePaths, makeMain = false) => {
    if (!validKey(key)) return rendererState();
    let files = filePaths?.length ? filePaths : null;
    if (!files) {
      const r = await dialog.showOpenDialog(win, { title: 'Competitor photos', properties: ['openFile', 'multiSelections'], filters: imageFilter });
      if (r.canceled || !r.filePaths.length) return rendererState();
      files = r.filePaths;
    }
    const failed = [];
    for (const [i, f] of files.entries()) {
      try { await addCompetitorPhoto(key, f, { makeMain: makeMain && i === 0 }); } catch (e) { failed.push(`${path.basename(f)}: ${e.message}`); }
    }
    rebuild();
    return failed.length ? withError(`These files could not be used: ${failed.join('; ')}`) : rendererState();
  });
  // bytes = pasted image, webcam shot, or a dropped image that has no file on disk (e.g. dragged out of an app).
  // target = { key } of a card, or { number } typed in the "Photo for which number?" window.
  ipcMain.handle('comp-photo-bytes', async (_e, target, bytes, makeMain = true) => {
    let key = target?.key, created = false;
    if (!validKey(key)) {
      const n = numberKey(target?.number);
      if (!n) return withError('The start number must be a number from 1 to 9999.');
      ({ key, created } = competitorForNumber(n, 'manual')); // a photo for a number nobody has creates a typed competitor
    }
    try { await addCompetitorPhotoBytes(key, bytes, { makeMain }); }
    catch (e) { if (created) store.deleteCompetitor(key); rebuild(); return withError(`The image could not be used: ${e.message}`); }
    rebuild(); return { ...rendererState(), key };
  });
  ipcMain.handle('comp-photo-main', (_e, key, file) => { if (validKey(key)) store.setCompetitorMain(key, file); rebuild(); return rendererState(); });
  ipcMain.handle('comp-photo-delete', (_e, key, file) => { if (validKey(key)) store.deleteCompetitorPhoto(key, file); rebuild(); return rendererState(); });
  // crop of one photo; without a file name it is the main photo's
  ipcMain.handle('comp-crop', (_e, key, crop, file) => {
    const target = validKey(key) && (file || mainPhoto(store.competitor(key) || {})?.file);
    if (target) store.setCompetitorCrop(key, target, crop ? cleanCrop(crop) : null);
    rebuild(); return rendererState();
  });
  ipcMain.handle('comp-photo-rotate', async (_e, key, file, degrees) => {
    let newFile = null;
    try {
      if (!validKey(key)) throw new Error('unknown competitor');
      newFile = await rotateCompetitorPhoto(key, file, [90, -90, 180].includes(degrees) ? degrees : 90);
    } catch (e) { dialog.showErrorBox('Rotate photo', `The photo could not be turned: ${e.message}`); }
    rebuild(); return { state: rendererState(), file: newFile };
  });
  // the camera chosen in the Webcam window, remembered for next time
  ipcMain.handle('set-webcam', (_e, id) => { store.updateConfig({ webcamId: id ? String(id) : null }); return rendererState(); });

  // ---- ČSTS lookup by IDT (C-33) ----
  // Returns { found: { name, surname, club, guessed } }, { found: null } (no such IDT) or { error }
  ipcMain.handle('csts-lookup', async (_e, idt) => {
    try { return { found: await csts.lookup(idt) }; }
    catch (e) { return { error: e.message }; }
  });

  // ---- phone upload (C-34) ----
  // patch: { enabled } switches the page on/off; { newKey: true } makes a new link (the old QR code stops working)
  ipcMain.handle('phone-upload', (_e, patch) => {
    const next = { ...(store.cfg.phoneUpload || {}) };
    if ('enabled' in patch) next.enabled = !!patch.enabled;
    if (patch.newKey || (next.enabled && !next.key)) next.key = newUploadKey();
    store.updateConfig({ phoneUpload: next });
    publish(); return rendererState();
  });
  // QR code picture of one of our own upload addresses (nothing else is turned into a QR code)
  ipcMain.handle('qr', (_e, url) => (/^http:\/\/[\d.]+:\d+\/upload\?key=[\w-]+$/.test(url) ? QRCode.toDataURL(url, { margin: 1, width: 360 }) : null));
}

// ---------------------------------------------------------------------------------------------------------
// IPC: reading a DanS printout with the webcam (D-17, D-24, C-39 to C-41)
// ---------------------------------------------------------------------------------------------------------

// What a printout is matched against: the offline copy (competitions with their rounds, the start list, the event's
// judges) and the app's own lists (typed competitors, the judge gallery).
function printoutKnown() {
  const rawComp = new Map((raw?.competitions || []).map((c) => [c.id, c]));
  const judges = new Map();
  for (const j of model?.judges.values() || []) if (j.fedId) judges.set(j.fedId, { fedId: j.fedId, name: j.name, surname: j.surname });
  for (const [fedId, g] of store.galleryEntries()) {
    // gallery names win, as everywhere else
    const cur = judges.get(fedId) || { fedId };
    judges.set(fedId, { ...cur, name: g.name || cur.name || '', surname: g.surname || cur.surname || '' });
  }
  return {
    competitions: (model?.competitions || []).map((c) => ({ id: c.id, number: c.number, title: c.title, rounds: (rawComp.get(c.id)?.rounds || []).map((r) => r.name) })),
    competitors: competitorList(raw, store).map((c) => ({ key: c.key, people: c.people, label: competitorLabel(c) })),
    judges: [...judges.values()].filter((j) => j.name || j.surname),
  };
}

function setupPrintoutIpc() {
  ocr.setCacheDir(path.join(store.dir, 'ocr-cache'));

  // bytes = the photo (webcam frame, pasted or chosen image). The photo is read twice – as taken, and prepared
  // (enlarged, grey, light evened out) – and the two readings are combined: each catches what the other misses.
  // Returns { result } (see printout.js mergeResults, plus the recognised text) or { error }.
  ipcMain.handle('printout-read', (_e, bytes, o) => readPrintout(bytes, o || {}));
  // the Turn button in the Read printout window: the camera picture is shown and read turned this far
  ipcMain.handle('printout-rotate', (_e, deg) => {
    const r = Number(deg);
    store.updateConfig({ printoutRotate: [0, 90, 180, 270].includes(r) ? r : 0 });
    return rendererState();
  });
}

// Reads one photo of a printout: { result } or { error }. Used by the window and by the phone page.
//
// Which way up (C-42): Tesseract reads only upright text, and a webcam turned on its side (to fit a whole A4 page)
// gives a picture lying on its side. The photo is first read turned by the remembered amount (printoutRotate). If
// that reading finds nothing known and the text recognition itself is unsure, the other three turns are tried and
// the best one wins – and is remembered, so the next read is quick again. Text lying on its side reads as junk with
// low confidence, so the comparison is clear.
//   opts.rotate: a turn chosen by hand – used as it is, nothing else is tried.
//   opts.camera: a frame of the printout camera – starts at the remembered turn and updates it. Any other photo
//                (file, Ctrl+V, phone) starts upright and leaves the camera's turn alone.
async function readPrintout(bytes, opts = {}) {
  const base = path.join(app.getPath('temp'), `dp-print-${Date.now()}`);
  const src = base + '.img', prep = base + '-prep.png', plain = base + '-plain.png';
  try {
    fs.writeFileSync(src, Buffer.from(bytes));
    const known = printoutKnown();
    // one reading of the enhanced picture, turned by rot degrees
    const readAt = async (rot) => {
      await prepareForOcr(src, prep, { rotate: rot });
      const reading = await ocr.recognize(prep);
      const parsed = parsePrintout(reading.text, known);
      const found = parsed.competitors.length + parsed.judges.length + (parsed.header?.compId ? 1 : 0);
      return { rot, reading, parsed, found };
    };
    // good enough to stop looking: something known was found, or the text itself was read confidently
    // (an upright page of names nobody knows yet still reads at 70+ %, a page on its side well below 50 %)
    const good = (r) => r.found >= 2 || r.reading.confidence >= 65;
    const better = (a, b) => (a.found !== b.found ? a.found > b.found : a.reading.confidence > b.reading.confidence);

    const manual = opts.rotate != null && [0, 90, 180, 270].includes(Number(opts.rotate));
    const first = manual ? Number(opts.rotate) : opts.camera ? (store.cfg.printoutRotate || 0) : 0;
    let best = await readAt(first);
    if (!manual && !good(best)) {
      // the usual turns first: on its side either way, then upside down
      for (const rot of [90, 270, 180, 0].filter((x) => x !== first)) {
        const r = await readAt(rot);
        if (better(r, best)) best = r;
        if (good(best)) break;
      }
      if (opts.camera && best.rot !== (store.cfg.printoutRotate || 0)) store.updateConfig({ printoutRotate: best.rot });
    }
    // second reading: the same turn, not enhanced (see C-39 – each reading catches rows the other misses)
    await prepareForOcr(src, plain, { rotate: best.rot, enhance: false });
    const second = parsePrintout((await ocr.recognize(plain)).text, known);
    const result = mergeResults([best.parsed, second]);
    return { result: { ...result, text: best.reading.text, confidence: best.reading.confidence, rotate: best.rot } };
  } catch (e) {
    return { error: `The printout could not be read: ${e.message}` };
  } finally {
    for (const f of [src, prep, plain]) fs.rm(f, { force: true }, () => {});
  }
}

function setupPrintoutApplyIpc() {
  // Puts what the operator checked in the review window into the app. Nothing reaches the screen until Push.
  // p = { competitionId, header: { number, title, titleEn, round }, competitors: [{ key, number }],
  //       judges: [{ fedId, letter }], useCompetitors, useJudges, side }
  ipcMain.handle('printout-apply', (_e, p) => {
    const comp = model?.competitions.find((c) => c.id === p.competitionId) || null;
    const hd = {
      number: String(p.header?.number ?? comp?.number ?? '').trim(),
      title: String(p.header?.title || comp?.title || '').trim(),
      titleEn: String(p.header?.titleEn || comp?.titleEn || '').trim(),
      round: String(p.header?.round || '').trim(),
    };

    if (p.useCompetitors) {
      const list = competitorList(raw, store);
      const rows = (p.competitors || []).map((r) => ({ key: r.key, n: numberKey(r.number) })).filter((r) => r.n && /^(dans|m):[\w-]{1,64}$/.test(r.key));
      // A number belongs to one competitor: a printout number given earlier to someone else is taken back
      const taken = new Set(rows.map((r) => r.n));
      for (const c of list) {
        const s = store.competitor(c.key);
        if (s?.printNumber && taken.has(numberKey(s.printNumber)) && !rows.some((r) => r.key === c.key)) store.updateCompetitor(c.key, { printNumber: null });
      }
      for (const r of rows) {
        const c = list.find((x) => x.key === r.key);
        if (!c) continue;
        if (r.key.startsWith('m:')) store.updateCompetitor(r.key, { number: r.n });
        // a DanS competitor: the printed number is kept as "number from printout" unless DanS's own already says so
        else {
          const dansOwn = c.numberFrom === 'dans' ? c.number : null;
          store.updateCompetitor(r.key, { printNumber: dansOwn === r.n ? null : r.n });
        }
      }
      const scr = store.cfg.competitorScreen;
      for (const k of ['number', 'title', 'titleEn', 'round']) delete scr[k];
      Object.assign(scr, { competitionId: comp?.id || null, roundId: null, roundName: hd.round, numbers: [...taken], mode: 'round' });
      // without a known competition the header is typed from what was read
      if (!comp) Object.assign(scr, { number: hd.number || undefined, title: hd.title || undefined });
      store.config.save();
    }

    if (p.useJudges) {
      const side = p.side === 'B' && store.cfg.split ? 'B' : 'A';
      const names = new Map(printoutKnown().judges.map((j) => [j.fedId, j]));
      const judges = (p.judges || []).filter((j) => j.fedId && names.has(String(j.fedId)));
      // judges of the event that are not in the gallery yet get an entry (names only), like an own selection needs
      for (const j of judges) store.ensureJudge(String(j.fedId), { name: names.get(String(j.fedId)).name, surname: names.get(String(j.fedId)).surname });
      store.cfg.manualPanels[side] = {
        ...(hd.number ? { number: hd.number } : {}), ...(hd.title ? { title: hd.title } : {}),
        ...(hd.titleEn ? { titleEn: hd.titleEn } : {}), ...(hd.round ? { round: hd.round } : {}),
        judges: judges.map((j) => ({ fedId: String(j.fedId), letter: cleanLetter(j.letter) || '' })),
      };
      store.cfg.slots[side].source = 'manual';
      store.config.save();
    }
    rebuild(); return rendererState();
  });
}

// Names as typed, at most two people; each { name, surname, idt } with the IDT kept to digits.
function cleanPeople(list) {
  return (Array.isArray(list) ? list : []).slice(0, 2).map((p) => ({
    name: String(p?.name || '').trim().slice(0, 60),
    surname: String(p?.surname || '').trim().slice(0, 60),
    idt: String(p?.idt || '').replace(/\D/g, '').slice(0, 10),
  }));
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
  await normalizeExistingPhotos();
  server = new OutputServer({
    outputsDir: path.join(__dirname, '..', 'outputs'),
    photoDir: store.photoDir,
    mediaDir: store.mediaDir,
    brandDir: BRAND_DIR, // for the background in the app's preview
  });
  // The projection starts with whatever was pushed last time, so a restart doesn't change the screen.
  projection = new Projection({ server, file: path.join(store.dir, 'pushed.json') });
  projection.setAuto(store.cfg.projectionAuto);
  // Competitor projection: its own server, port and pushed state (C-32); it also carries the phone upload page.
  compServer = new OutputServer({
    outputsDir: path.join(__dirname, '..', 'outputs'),
    photoDir: store.photoDir,
    mediaDir: store.mediaDir,
    brandDir: BRAND_DIR,
    upload: phoneUpload,
  });
  compProjection = new Projection({ server: compServer, file: path.join(store.dir, 'pushed-competitors.json'), sections: COMPETITOR_SECTIONS });
  compProjection.setAuto(store.cfg.projectionAuto);
  cleanupFiles();
  try {
    outputAddr = await server.listen(store.cfg.outputPort, store.cfg.outputHost);
  } catch (e) {
    dialog.showErrorBox('Output server', `Port ${store.cfg.outputPort} is busy: ${e.message}`);
  }
  try {
    compAddr = await compServer.listen(store.cfg.competitorPort, store.cfg.outputHost);
  } catch (e) {
    dialog.showErrorBox('Competitor output server', `Port ${store.cfg.competitorPort} is busy: ${e.message}`);
  }

  if (fixtureFile) {
    raw = JSON.parse(fs.readFileSync(path.resolve(fixtureFile), 'utf8'));
    poller = new FixturePoller(raw);
  } else {
    poller = new Poller({ dans: new DansClient(store.cfg.server), intervalMs: store.cfg.pollMs });
  }
  // Every successful read: keep an offline copy (for manual mode / starting without DanS) and rebuild.
  poller.liveRounds = liveRoundIds; // heat tracking (D-29): automatic mode reads the marks of these rounds
  poller.on('raw', (r) => { raw = r; if (!fixtureFile) store.saveSnapshot(r); rebuild(); });
  poller.on('status', (s) => { const changed = s.connected !== status.connected || s.error !== status.error; status = s; if (changed) publish(); else win?.webContents.send('status', s); });

  setupIpc();
  purgeOldData();                                            // what the app collected about past events (D-30)
  setInterval(purgeOldData, 3600 * 1000);
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1100, minHeight: 680, backgroundColor: '#0f1115', title: 'Dance Projector',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  // The hidden image decoder (imagedecode.js) is a window too; close it with the main window so the app quits.
  win.on('closed', closeWorker);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });

  if (fixtureFile) { await loadEvents(); poller.start(); }
  else { dans = new DansClient(store.cfg.server); poller.setClient(dans); await loadEvents(); selectEvent(); applyMode(); }
  publish();
}

app.whenReady().then(start);
app.on('window-all-closed', () => { store?.flush(); server?.close(); compServer?.close(); poller?.stop(); ocr.stop(); app.quit(); });
