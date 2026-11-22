'use strict';
// Tests for the operator workflow added on 2026-11-19 (decisions D-13 to D-15):
// styles, hand-picked judge panels, push to projection, the on-demand read and the offline copy.
// Plain Node, no Electron; uses the anonymised sample event.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { buildModel } = require('../src/main/model');
const { panelKey, applyPanels, togglePanel } = require('../src/main/panels');
const { cleanTheme, themeFor, DEFAULT_THEME } = require('../src/main/theme');
const { Projection } = require('../src/main/projection');
const { OutputServer } = require('../src/main/server');
const { Poller } = require('../src/main/poller');
const { Store } = require('../src/main/store');
const { outputState } = require('../src/main/view');

const raw = require(path.join(__dirname, '..', 'fixtures', 'sample.json'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-flow-'));

// ---- theme: only valid values survive; old wholeColor seeds the accent ----
assert.deepStrictEqual(cleanTheme({ accent: '#abcdef', ground: 'red', panelOpacity: 150, imageDim: -5, background: 'video', image: '../x.jpg' }),
  { accent: '#ABCDEF', panelOpacity: 100, imageDim: 0 });
assert.strictEqual(themeFor({ themes: {} }, 'e1').accent, DEFAULT_THEME.accent);
assert.strictEqual(themeFor({ wholeColor: '#112233', themes: {} }, 'e1').accent, '#112233');
assert.strictEqual(themeFor({ themes: { e1: { accent: '#445566' } } }, 'e1').accent, '#445566');
assert.strictEqual(themeFor({ themes: { e1: { accent: '#445566' } } }, 'e2').accent, DEFAULT_THEME.accent, 'styles are per event');

// ---- panels: an override replaces the DanS panel and is marked as manual ----
const m = buildModel(raw);
const c1 = m.competitions.find((c) => c.number === 1);
const dansIds = c1.judges.map((j) => j.personId);
assert.strictEqual(dansIds.length, 7);
const anyOther = [...m.judges.keys()].find((id) => !dansIds.includes(id));
// first click on a DanS panel starts from the DanS list
const edited = togglePanel(undefined, dansIds, dansIds[0]);
assert.deepStrictEqual(edited, dansIds.slice(1));
assert.deepStrictEqual(togglePanel(edited, dansIds, anyOther), [...dansIds.slice(1), anyOther]);
applyPanels(m, { [panelKey(c1)]: [...edited, anyOther] });
assert.strictEqual(c1.panelSource, 'manual');
assert.strictEqual(c1.judges.length, 7);
assert.ok(c1.judges.some((j) => j.personId === anyOther));
assert.deepStrictEqual(c1.dansJudges.map((j) => j.personId), dansIds, 'DanS panel kept for comparison');
const letters = c1.judges.map((j) => j.letter);
assert.deepStrictEqual(letters, [...letters].sort((a, b) => a.localeCompare(b, 'cs')), 'sorted by letter');
const m2 = applyPanels(buildModel(raw), {});
assert.strictEqual(m2.competitions.find((c) => c.number === 1).panelSource, 'dans');
// overrides are per round (C-47): an old competition-keyed one or another round's one leaves the DanS panel alone
assert.ok(c1.round, 'fixture competition 1 has a round');
assert.strictEqual(panelKey(c1), `round:${c1.round.id}`);
const m3 = applyPanels(buildModel(raw), { [c1.id]: [], 'round:some-earlier-round': [] });
assert.strictEqual(m3.competitions.find((c) => c.number === 1).panelSource, 'dans');
assert.strictEqual(m3.competitions.find((c) => c.number === 1).judges.length, 7);
// a competition without rounds still uses its own id
assert.strictEqual(panelKey({ id: 'c9', round: null }), 'c9');

// ---- store: panels, offline copy, cleanup that spares what is on screen ----
const store = new Store(dir);
store.setPanel('ev', 'c1', ['a', 'b', 'a']);
assert.deepStrictEqual(store.panelOverrides('ev'), { c1: ['a', 'b'] });
store.setPanel('ev', 'c1', null);
assert.deepStrictEqual(store.panelOverrides('ev'), {});
fs.writeFileSync(path.join(store.photoDir, 'old.jpg'), 'x');
fs.writeFileSync(path.join(store.photoDir, 'shown.jpg'), 'x');
store.cleanupFiles(new Set(['shown.jpg']));

// ---- projection + server: OBS sees only what was pushed ----
const srv = new OutputServer({ outputsDir: path.join(__dirname, '..', 'src', 'outputs'), photoDir: store.photoDir, mediaDir: store.mediaDir });
const file = path.join(dir, 'pushed.json');
const proj = new Projection({ server: srv, file });
store.updateConfig({ eventId: raw.event.id, slots: { A: { competitionId: c1.id } } });
const draft1 = outputState(m, raw, store, { connected: true });
proj.setDraft(draft1);
assert.ok(proj.changes().length, 'nothing pushed yet = everything is a change');
assert.strictEqual(srv.channels.live.version, 0, 'draft does not reach the live channel');
assert.ok(proj.push());
assert.deepStrictEqual(proj.changes(), []);
assert.strictEqual(proj.push(), false, 'pushing the same state again does nothing');
// edit the style: draft changes, screen does not
store.updateConfig({ themes: { [raw.event.id]: { accent: '#00FF00' } } });
proj.setDraft(outputState(m, raw, store, { connected: true }));
assert.deepStrictEqual(proj.changes(), ['Competition / panel A', 'Style'], 'whole-floor slot takes the accent colour');
assert.strictEqual(srv.channels.live.state.theme.accent, DEFAULT_THEME.accent);
assert.strictEqual(srv.channels.draft.state.theme.accent, '#00FF00');
// the pushed state survives a restart
const proj2 = new Projection({ server: new OutputServer({ outputsDir: '.', photoDir: '.' }), file });
assert.strictEqual(proj2.pushed.theme.accent, DEFAULT_THEME.accent);
// automatic projection pushes on every draft
proj.setAuto(true);
assert.strictEqual(srv.channels.live.state.theme.accent, '#00FF00');

// ---- poller: on-demand read makes 3 requests once data exists, none without a press ----
const calls = [];
const fake = {
  events: async () => [], indexes: async () => ({}), startlist: async () => [], draw: async () => null,
  competitions: async () => { calls.push('competitions'); return raw.competitions; },
  judges: async () => { calls.push('judges'); return raw.judges; },
  allocation: async () => { calls.push('allocation'); return raw.allocation; },
};
const poller = new Poller({ dans: fake });
poller.seed(raw.event, JSON.parse(JSON.stringify(raw)));
let emitted = 0;
poller.on('raw', () => emitted++);

(async () => {
  await poller.fetchOnce();
  assert.deepStrictEqual(calls.sort(), ['allocation', 'competitions', 'judges']);
  assert.strictEqual(emitted, 1);
  assert.ok(poller.status.connected);
  // a failing read reports the error and keeps the old data
  fake.allocation = async () => { throw new Error('DanS 500'); };
  await assert.rejects(poller.fetchOnce(), /DanS 500/);
  assert.strictEqual(poller.status.connected, false);
  assert.ok(poller.raw.competitions.length);

  // offline copy round trip (written in the background)
  store.saveSnapshot({ ...raw, fetchedAt: 123 });
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(store.loadSnapshot(raw.event.id).fetchedAt, 123);
  assert.deepStrictEqual(store.listSnapshots().map((e) => e.id), [raw.event.id]);

  // cleanup removed the unused photo and kept the one on screen
  assert.ok(!fs.existsSync(path.join(store.photoDir, 'old.jpg')));
  assert.ok(fs.existsSync(path.join(store.photoDir, 'shown.jpg')));

  // HTTP: live by default, draft on request, CORS for the OBS branding pages
  const { port } = await srv.listen(0, '127.0.0.1');
  const get = (p) => new Promise((r) => http.get(`http://127.0.0.1:${port}${p}`, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => r({ code: res.statusCode, headers: res.headers, body: b })); }));
  proj.setAuto(false);
  store.updateConfig({ themes: { [raw.event.id]: { accent: '#0000FF' } } });
  proj.setDraft(outputState(m, raw, store, { connected: true }));
  const live = await get('/api/state'), draft = await get('/api/state?view=draft');
  assert.strictEqual(JSON.parse(live.body).theme.accent, '#00FF00');
  assert.strictEqual(JSON.parse(draft.body).theme.accent, '#0000FF');
  assert.strictEqual(live.headers['access-control-allow-origin'], '*');
  assert.strictEqual((await get(`/api/state?since=${JSON.parse(live.body).version}`)).code, 204);
  assert.notStrictEqual((await get('/media/..%2F..%2Fconfig.json')).code, 200, 'no way out of the media folder');
  console.log('OK');
  srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
