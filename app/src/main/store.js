'use strict';
// JSON settings and judge data in the Electron userData folder.
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  server: 'http://localhost:8686',
  servers: [],           // saved DanS servers: [{ name, url }]
  eventId: null,
  pollMs: 2000,
  runningStates: ['InProgress'],
  outputPort: 8787,
  outputHost: '0.0.0.0',
  slots: {
    A: { competitionId: null, follow: false, label: 'Levá strana', labelEn: 'Left side', color: '#1E7BFF' },
    B: { competitionId: null, follow: false, label: 'Pravá strana', labelEn: 'Right side', color: '#FF3B4E' },
  },
  split: false,          // floor split in two halves (only sometimes, for small competitions)
  wholeColor: '#E8B931', // accent when the whole floor is one competition
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
    fs.mkdirSync(this.photoDir, { recursive: true });
    this.config = new JsonFile(path.join(dir, 'config.json'), DEFAULT_CONFIG);
    // judges.json: { "<federation id>": { displayName, photo } }
    this.judges = new JsonFile(path.join(dir, 'judges.json'), {});
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

  judge(fedId) { return this.judges.data[fedId] || {}; }
  updateJudge(fedId, patch) {
    if (!fedId) throw new Error('judge has no federation id');
    const cur = { ...this.judge(fedId), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] === null || cur[k] === '') delete cur[k];
    if (Object.keys(cur).length) this.judges.data[fedId] = cur; else delete this.judges.data[fedId];
    this.judges.save();
    return cur;
  }

  importPhoto(fedId, srcFile) {
    const ext = path.extname(srcFile).toLowerCase() || '.jpg';
    const name = `${String(fedId).replace(/[^\w-]/g, '_')}-${Date.now()}${ext}`;
    fs.copyFileSync(srcFile, path.join(this.photoDir, name));
    const old = this.judge(fedId).photo;
    this.updateJudge(fedId, { photo: name, crop: null });
    if (old) fs.rm(path.join(this.photoDir, old), { force: true }, () => {});
    return name;
  }

  removePhoto(fedId) {
    const old = this.judge(fedId).photo;
    this.updateJudge(fedId, { photo: null, crop: null });
    if (old) fs.rm(path.join(this.photoDir, old), { force: true }, () => {});
  }

  flush() { this.config.flush(); this.judges.flush(); }
}

module.exports = { Store, DEFAULT_CONFIG, normalizeServer };
