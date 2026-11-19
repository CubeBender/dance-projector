'use strict';
// Everything the app keeps on disk, all inside the Electron userData folder (%APPDATA%\dance-projector):
//
//   config.json   settings (server, event, modes, slots, styles, …)
//   judges.json   judge gallery per IDT: names, all photos with crops, main portrait (reused at every event)
//   panels.json   judge panels picked by the operator: { eventId: { competitionId: [personId, …] } }
//   cache/        the last data read from DanS per event, for manual mode and for starting without DanS
//   photos/       judge photos        media/   background images of the styles
//   pushed.json   what is on the projection (written by projection.js)
const fs = require('fs');
const path = require('path');
const { migrateEntry } = require('./gallery');

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
    A: { source: 'dans', competitionId: null, follow: false, label: 'Levá strana', labelEn: 'Left side', color: '#1E7BFF' },
    B: { source: 'dans', competitionId: null, follow: false, label: 'Pravá strana', labelEn: 'Right side', color: '#FF3B4E' },
  },
  // Own selections per side: { number, title, titleEn, round, judges: [{ fedId, letter }] } – see view.js manualCompetition
  manualPanels: { A: { judges: [] }, B: { judges: [] } },
  split: false,          // floor split in two halves (only sometimes, for small competitions)
  // wholeColor: older setting for the whole-floor accent; now the style's accent (theme.js) and only read from old configs
  language: { primary: 'cs', secondary: 'en' }, // secondary: 'en' | 'cs' | 'none'
  heatsShow: 'full', // 'full' (number, name, club) | 'names' (number, name) | 'numbers'
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
  }

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
    for (const dir of [this.photoDir, this.mediaDir]) {
      for (const f of fs.readdirSync(dir)) {
        if (used.has(f)) continue;
        try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* locked by another program: try next time */ }
      }
    }
  }

  flush() { this.config.flush(); this.judges.flush(); this.panels.flush(); }
}

module.exports = { Store, DEFAULT_CONFIG, normalizeServer };
