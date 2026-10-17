'use strict';
// Serves the output pages from a fixture without Electron, for design work and screenshots.
// usage: node scripts/preview-server.js [fixture] [slotA comp number] [slotB comp number] [port]
const os = require('os');
const path = require('path');
const fs = require('fs');
const { buildModel } = require('../src/main/model');
const { Store } = require('../src/main/store');
const { OutputServer } = require('../src/main/server');
const { outputState } = require('../src/main/view');

const fixture = process.argv[2] || path.join(__dirname, '..', 'fixtures', 'sample.json');
const a = Number(process.argv[3] || 3), b = Number(process.argv[4] || 1), port = Number(process.argv[5] || 8788);
const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'dp-preview-')));
const model = buildModel(raw, { runningStates: ['InProgress', 'Paused'] });
// Optional settings for screenshots, e.g. PREVIEW_CFG='{"split":true,"heatsShow":"numbers"}'
if (process.env.PREVIEW_CFG) Object.assign(store.cfg, JSON.parse(process.env.PREVIEW_CFG));
// Optional photos folder copied in, e.g. PREVIEW_DATA=<app data folder> to reuse real judge photos
if (process.env.PREVIEW_DATA) {
  const src = process.env.PREVIEW_DATA;
  try { store.judges.data = JSON.parse(fs.readFileSync(path.join(src, 'judges.json'), 'utf8')); } catch {}
  for (const f of fs.existsSync(path.join(src, 'photos')) ? fs.readdirSync(path.join(src, 'photos')) : []) fs.copyFileSync(path.join(src, 'photos', f), path.join(store.photoDir, f));
}
store.cfg.slots.A.competitionId = model.competitions.find((c) => c.number === a)?.id || null;
store.cfg.slots.B.competitionId = model.competitions.find((c) => c.number === b)?.id || null;

const server = new OutputServer({ outputsDir: path.join(__dirname, '..', 'src', 'outputs'), photoDir: store.photoDir });
server.listen(port, '127.0.0.1').then(() => {
  server.publish(outputState(model, raw, store, { connected: true }));
  console.log(`preview on http://127.0.0.1:${port}/out/`);
});
