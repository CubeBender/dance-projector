'use strict';
// Everything the app keeps on disk, all inside the Electron userData folder (%APPDATA%\dance-projector):
//
//   config.json   settings (server, event, modes, slots, styles, …)
//   judges.json   judge gallery per IDT: names, all photos with crops, main portrait (reused at every event)
//   panels.json   judge panels picked by the operator: { eventId: { competitionId: [personId, …] } }
//   competitors.json  competitors per event and start number: names, photos (competitors.js, decision C-31)
//   cache/        the last data read from DanS per event, for manual mode and for starting without DanS
//   photos/       judge photos        media/   background images of the styles
//   pushed.json   what is on the projection (written by projection.js); pushed-competitors.json the same for
//                 the competitor projection
const fs = require('fs');
const path = require('path');
const { migrateEntry, withPhoto, withoutPhoto, withPhotoChange } = require('./gallery');
const { themeKey } = require('./theme');

const DEFAULT_CONFIG = {
  server: 'http://localhost:8686',
  servers: [],           // saved DanS servers: [{ name, url }]
  eventId: null,
  pollMs: 2000,
  // How data comes from DanS (D-13): 'manual' = never contact DanS, use the offline copy;
  // 'ondemand' = only when the operator presses Fetch now; 'auto' = poll every pollMs.
  mode: 'ondemand',
  // false = the projection changes only on "Push to projection"; true = every change goes straight out.
  projectionAuto: false,
  themes: {},            // style per event id, see theme.js
  runningStates: ['InProgress'],
  outputPort: 8787,
  outputHost: '0.0.0.0',
  slots: {
    // source: 'dans' = a competition from the DanS list, 'manual' = own selection from the gallery (D-19)
    // judgeSort: order of the judge cards, 'surname' | 'firstname' | 'letter' | 'custom' (panels.js sortJudges)
    // order: IDTs in the custom order
    A: { source: 'dans', competitionId: null, follow: false, label: 'Levá strana', labelEn: 'Left side', color: '#1E7BFF', judgeSort: 'surname', order: [] },
    B: { source: 'dans', competitionId: null, follow: false, label: 'Pravá strana', labelEn: 'Right side', color: '#FF3B4E', judgeSort: 'surname', order: [] },
  },
  // Own selections per side: { number, title, titleEn, round, judges: [{ fedId, letter }] } – see view.js manualCompetition
  manualPanels: { A: { judges: [] }, B: { judges: [] } },
  split: false,          // floor split in two halves (only sometimes, for small competitions)
  // wholeColor: older setting for the whole-floor accent; now the style's accent (theme.js) and only read from old configs
  language: { primary: 'cs', secondary: 'en' }, // secondary: 'en' | 'cs' | 'none'
  heatsShow: 'full', // 'full' (number, name, club) | 'names' (number, name) | 'numbers'
  // ---- competitors (D-22) ----
  competitorPort: 8788,  // the competitor projection has its own output server and port (C-32)
  // What the competitor projection shows (C-36):
  //   competitionId  DanS competition the header comes from (null = typed header only)
  //   roundId/roundName  the DanS round the numbers were loaded from
  //   number, title, titleEn, round  typed header, wins over DanS
  //   numbers   start numbers in the round, as strings
  //   mode      'round' = all of them as cards | 'spotlight' = one competitor large
  //   spotlight start number shown in spotlight mode
  competitorScreen: { competitionId: null, roundId: null, roundName: '', numbers: [], mode: 'round', spotlight: null },
  // Phone upload page (C-34): off until switched on; key = the secret part of the link
  phoneUpload: { enabled: false, key: null },
  webcamId: null,        // camera chosen in the Webcam window (C-35)
  // How far the printout camera picture must be turned (degrees clockwise) to make the text upright: a webcam turned
  // on its side fits a whole A4 page. Found automatically and remembered, or set with the Turn button (C-42).
  printoutRotate: 0,
};

class JsonFile {
  constructor(file, defaults) {
    this.file = file;
    this.data = defaults;
    try { this.data = merge(structuredClone(defaults), JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* first run */ }
    this.timer = null;
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

function merge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

// "192.168.1.80:8686/" -> "http://192.168.1.80:8686"
function normalizeServer(url) {
  url = String(url || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url;
}
function hostOf(url) { try { return new URL(url).host; } catch { return url; } }

class Store {
  constructor(dir) {
    this.dir = dir;
    this.photoDir = path.join(dir, 'photos');
    this.mediaDir = path.join(dir, 'media');
    this.cacheDir = path.join(dir, 'cache');
    for (const d of [this.photoDir, this.mediaDir, this.cacheDir]) fs.mkdirSync(d, { recursive: true });
    this.config = new JsonFile(path.join(dir, 'config.json'), DEFAULT_CONFIG);
    // judges.json: the judge gallery, { "<IDT>": entry } – see gallery.js. Old single-photo entries are
    // converted on load (and written back in the new shape on the next save).
    this.judges = new JsonFile(path.join(dir, 'judges.json'), {});
    for (const [id, e] of Object.entries(this.judges.data)) this.judges.data[id] = migrateEntry(e);
    this.panels = new JsonFile(path.join(dir, 'panels.json'), {});
    this.competitors = new JsonFile(path.join(dir, 'competitors.json'), {});
    // Entries saved before C-37 were keyed by start number ("7"); they become typed entries ('m:7') that carry the
    // number. Once DanS has that number they move onto the DanS competitor (main.js attachCompetitors).
    let moved = false;
    for (const ev of Object.values(this.competitors.data)) {
      for (const k of Object.keys(ev)) {
        if (!/^\d+$/.test(k)) continue;
        ev[`m:${k}`] = { number: k, ...ev[k] }; delete ev[k]; moved = true;
      }
    }
    if (moved) this.competitors.save();
  }

  // ---- competitors per event, keyed by 'dans:<id>' or 'm:<id>' (competitors.js, C-31, C-37) ----
  // Every method works on the CURRENT event (config eventId; '_none' when no event is chosen), because start
  // numbers and DanS ids only mean something within one event. Methods take the competitor's key.
  get compKey() { return themeKey(this.cfg.eventId); }
  storedCompetitors() { return this.competitors.data[this.compKey] || {}; }
  competitor(key) { return this.storedCompetitors()[key] || null; }

  // Merges fields into the stored entry of a key (creating it). null or '' removes a field.
  updateCompetitor(key, patch) {
    const ev = this.competitors.data[this.compKey] || (this.competitors.data[this.compKey] = {});
    const cur = { ...(ev[key] || {}), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] === null || cur[k] === '') delete cur[k];
    ev[key] = cur;
    this.competitors.save();
    return cur;
  }
  // Photos of the same dancer(s) in ANOTHER event, found by IDT (C-38): a two-day championship is two DanS events,
  // with different start numbers each day, but the IDT stays. idts = all IDTs of the competitor (one for solo, two
  // for a couple); an entry matches only when it has exactly these IDTs, so a couple never borrows a solo photo.
  // Returns { photos, main, eventKey } of the most recently photographed match, or null.
  photosFromOtherEvent(idts) {
    const want = [...new Set((idts || []).filter(Boolean))].sort().join(',');
    if (!want) return null;
    let best = null;
    for (const [eventKey, ev] of Object.entries(this.competitors.data)) {
      if (eventKey === this.compKey) continue;
      for (const e of Object.values(ev)) {
        if (!e.photos?.length || [...new Set(e.idts || [])].sort().join(',') !== want) continue;
        const newest = Math.max(...e.photos.map((p) => Number(String(p.file).match(/-(\d{13})-/)?.[1] || 0)));
        if (!best || newest > best.newest) best = { photos: e.photos, main: e.main, eventKey, newest };
      }
    }
    return best && { photos: best.photos, main: best.main, eventKey: best.eventKey };
  }

  // Key for a new typed competitor (one DanS doesn't know)
  newManualKey() { return `m:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; }
  // Moves everything stored under one key to another (a typed entry onto its DanS competitor, competitors.js
  // attachToDans). Does nothing when the target already has data.
  moveCompetitor(from, to) {
    const ev = this.competitors.data[this.compKey];
    if (!ev?.[from] || ev[to]) return;
    const { number, origin, ...rest } = ev[from]; // the number comes from DanS from now on
    ev[to] = rest; delete ev[from];
    this.competitors.save();
  }
  // Forgets everything typed or added for a competitor (names, photos). A DanS competitor stays listed from DanS.
  deleteCompetitor(key) {
    const ev = this.competitors.data[this.compKey];
    if (!ev) return;
    delete ev[key];
    if (!Object.keys(ev).length) delete this.competitors.data[this.compKey];
    this.competitors.save();
  }
  // Photos: same rules as judges – unique file names, first photo becomes main, files removed later by
  // cleanupFiles() so the projection keeps its picture until the next push.
  addCompetitorPhoto(key, srcFile, { hash = null, makeMain = false } = {}) {
    const name = this.copyIntoPhotos(`c-${key}`, srcFile); // 'dans:…' → 'dans_…' in the file name
    this.updateCompetitor(key, withPhoto(this.competitor(key) || {}, { file: name, hash, crop: null }, makeMain));
    return name;
  }
  replaceCompetitorPhotoFile(key, oldFile, srcFile, { resetCrop = false } = {}) {
    const cur = this.competitor(key) || {};
    if (!(cur.photos || []).some((p) => p.file === oldFile)) throw new Error('photo not found');
    const name = this.copyIntoPhotos(`c-${key}`, srcFile); // 'dans:…' → 'dans_…' in the file name
    this.updateCompetitor(key, withPhotoChange(cur, oldFile, { file: name, ...(resetCrop ? { crop: null } : {}) }));
    return name;
  }
  deleteCompetitorPhoto(key, file) { this.updateCompetitor(key, withoutPhoto(this.competitor(key) || {}, file)); }
  setCompetitorMain(key, file) {
    if ((this.competitor(key)?.photos || []).some((p) => p.file === file)) this.updateCompetitor(key, { main: file });
  }
  setCompetitorCrop(key, file, crop) { this.updateCompetitor(key, withPhotoChange(this.competitor(key) || {}, file, { crop })); }
  hasCompetitorPhotoHash(key, hash) { return !!(hash && (this.competitor(key)?.photos || []).some((p) => p.hash === hash)); }

  // ---- judge panels picked by the operator (see panels.js) ----
  panelOverrides(eventId) { return this.panels.data[eventId] || {}; }
  // ids = list of person ids, or null to go back to the DanS panel
  setPanel(eventId, compId, ids) {
    if (!eventId || !compId) return;
    const ev = this.panels.data[eventId] || (this.panels.data[eventId] = {});
    if (ids === null) delete ev[compId]; else ev[compId] = [...new Set(ids)];
    if (!Object.keys(ev).length) delete this.panels.data[eventId];
    this.panels.save();
  }

  // ---- offline copy of DanS data, one file per event ----
  snapshotFile(eventId) { return path.join(this.cacheDir, String(eventId).replace(/[^\w-]/g, '_') + '.json'); }
  // Written in the background; skipped when the content is the same as last time (automatic mode reads every
  // 2 s and most reads change nothing).
  saveSnapshot(raw) {
    const id = raw?.event?.id;
    if (!id) return;
    const json = JSON.stringify({ ...raw, fetchedAt: undefined });
    if (this.lastSnapshot?.[id] === json) return;
    (this.lastSnapshot ||= {})[id] = json;
    const file = this.snapshotFile(id);
    fs.writeFile(file + '.tmp', JSON.stringify(raw), (err) => { if (!err) fs.rename(file + '.tmp', file, () => {}); });
  }
  loadSnapshot(eventId) {
    try { return JSON.parse(fs.readFileSync(this.snapshotFile(eventId), 'utf8')); } catch { return null; }
  }
  // Events that have an offline copy, for the event list when DanS is not used or not reachable.
  listSnapshots() {
    const out = [];
    for (const f of fs.readdirSync(this.cacheDir).filter((x) => x.endsWith('.json'))) {
      try { const r = JSON.parse(fs.readFileSync(path.join(this.cacheDir, f), 'utf8')); if (r.event?.id) out.push({ ...r.event, fetchedAt: r.fetchedAt }); } catch { /* broken file */ }
    }
    return out;
  }

  get cfg() { return this.config.data; }
  updateConfig(patch) { merge(this.config.data, patch); this.config.save(); return this.cfg; }

  // Saved servers. oldUrl identifies the entry being edited, so it can change its address.
  saveServer({ name, url }, oldUrl) {
    url = normalizeServer(url);
    if (!url) throw new Error('server address is empty');
    name = String(name || '').trim() || hostOf(url);
    const list = this.cfg.servers || [];
    const keys = new Set([url, oldUrl && normalizeServer(oldUrl)]);
    const at = list.findIndex((s) => keys.has(s.url));
    const rest = list.filter((s) => !keys.has(s.url));
    rest.splice(at < 0 ? rest.length : Math.min(at, rest.length), 0, { name, url });
    this.cfg.servers = rest; this.config.save();
    return rest;
  }
  removeServer(url) {
    url = normalizeServer(url);
    this.cfg.servers = (this.cfg.servers || []).filter((s) => s.url !== url); this.config.save();
    return this.cfg.servers;
  }

  // ---- judge gallery (see gallery.js for the shape of an entry) ----
  judge(fedId) { return this.judges.data[fedId] || {}; }
  // Every judge in the gallery as [fedId, entry] pairs.
  galleryEntries() { return Object.entries(this.judges.data); }

  // Merges fields into a judge. null or '' removes a field; an entry left empty is removed.
  updateJudge(fedId, patch) {
    if (!fedId) throw new Error('judge has no federation id');
    const cur = { ...this.judge(fedId), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] === null || cur[k] === '') delete cur[k];
    if (Object.keys(cur).length) this.judges.data[fedId] = cur; else delete this.judges.data[fedId];
    this.judges.save();
    return cur;
  }

  // Creates a gallery entry (or fills in missing names of an existing one) without touching its photos.
  ensureJudge(fedId, { name, surname } = {}) {
    const cur = this.judge(fedId);
    this.updateJudge(fedId, { photos: cur.photos || [], name: cur.name || name, surname: cur.surname || surname });
  }

  // Copies an already re-encoded image into photos/ and adds it to the judge.
  // hash identifies the original file, so importing the same folder twice doesn't add duplicates.
  // makeMain: true = becomes the portrait; otherwise only the first photo becomes main automatically.
  // enc: version of the encoder that made the file (see ENCODER in main.js).
  addPhoto(fedId, srcFile, { hash = null, makeMain = false, enc = null } = {}) {
    const name = this.copyIntoPhotos(fedId, srcFile);
    const cur = this.judge(fedId);
    const photos = [...(cur.photos || []), { file: name, hash, crop: null, ...(enc ? { enc } : {}) }];
    this.updateJudge(fedId, { photos, main: makeMain || !cur.main ? name : cur.main });
    return name;
  }
  // Unique file name per copy: a replaced photo never reuses a name, so nothing shows a stale cached image.
  copyIntoPhotos(fedId, srcFile) {
    const name = `${String(fedId).replace(/[^\w-]/g, '_')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
    fs.copyFileSync(srcFile, path.join(this.photoDir, name));
    return name;
  }
  hasPhotoHash(fedId, hash) { return !!this.photoByHash(fedId, hash); }
  photoByHash(fedId, hash) { return (hash && (this.judge(fedId).photos || []).find((p) => p.hash === hash)) || null; }

  // Swaps the file behind one photo (re-encoded or turned) and keeps its place in the list, its "main" status
  // and its hash. resetCrop: the old framing no longer fits (after turning). Returns the new file name.
  replacePhotoFile(fedId, oldFile, srcFile, { resetCrop = false, enc = undefined } = {}) {
    const cur = this.judge(fedId);
    if (!(cur.photos || []).some((p) => p.file === oldFile)) throw new Error('photo not found');
    const name = this.copyIntoPhotos(fedId, srcFile);
    const photos = cur.photos.map((p) => (p.file !== oldFile ? p
      : { ...p, file: name, ...(resetCrop ? { crop: null } : {}), ...(enc !== undefined ? { enc } : {}) }));
    this.updateJudge(fedId, { photos, main: cur.main === oldFile ? name : cur.main });
    return name; // the old file is removed by cleanupFiles() once nothing on screen uses it
  }

  // Removes one photo from the judge. The file itself stays until cleanupFiles(), because the projection may
  // still show it until the next push. If it was the main photo, the next one becomes main.
  deletePhoto(fedId, file) {
    const cur = this.judge(fedId);
    const photos = (cur.photos || []).filter((p) => p.file !== file);
    this.updateJudge(fedId, { photos, main: cur.main === file ? (photos[0]?.file || null) : cur.main });
  }
  setMainPhoto(fedId, file) {
    if ((this.judge(fedId).photos || []).some((p) => p.file === file)) this.updateJudge(fedId, { main: file });
  }
  // crop belongs to one photo: switching the main photo back and forth keeps each photo's framing
  setPhotoCrop(fedId, file, crop) {
    const cur = this.judge(fedId);
    this.updateJudge(fedId, { photos: (cur.photos || []).map((p) => (p.file === file ? { ...p, crop } : p)) });
  }

  // Removes a judge from the gallery (names, photo list) and from the own selections. The photo files go in the
  // next cleanupFiles(), so the projection keeps its images until the next push.
  deleteJudge(fedId) {
    delete this.judges.data[fedId];
    this.judges.save();
    for (const m of Object.values(this.cfg.manualPanels || {})) m.judges = (m.judges || []).filter((j) => j.fedId !== fedId);
    this.config.save();
  }

  // Older single-photo calls, kept for existing callers: replace = add as main; remove = delete the main photo.
  importPhoto(fedId, srcFile) { return this.addPhoto(fedId, srcFile, { makeMain: true }); }
  removePhoto(fedId) { const m = this.judge(fedId).main; if (m) this.deletePhoto(fedId, m); }

  // Deletes photos and background images nothing uses any more. keep = file names the projection still shows.
  cleanupFiles(keep = new Set()) {
    const used = new Set(keep);
    for (const j of Object.values(this.judges.data)) for (const p of j.photos || []) used.add(p.file);
    for (const t of Object.values(this.cfg.themes || {})) if (t.image) used.add(t.image);
    // competitor photos of every event (not only the current one)
    for (const ev of Object.values(this.competitors.data)) for (const c of Object.values(ev)) for (const p of c.photos || []) used.add(p.file);
    for (const dir of [this.photoDir, this.mediaDir]) {
      for (const f of fs.readdirSync(dir)) {
        if (used.has(f)) continue;
        try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* locked by another program: try next time */ }
      }
    }
  }

  flush() { this.config.flush(); this.judges.flush(); this.panels.flush(); this.competitors.flush(); }
}

module.exports = { Store, DEFAULT_CONFIG, normalizeServer };
