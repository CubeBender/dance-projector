'use strict';
// Competitors (D-22, 2026-11-20): start-list reading, merging with what the app keeps, screen names, ČSTS answers,
// the store, the competitor projection state and the phone upload routes. Made-up names only (public repository).
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const C = require('../src/main/competitors');
const { Store } = require('../src/main/store');
const { competitorState, competitorList } = require('../src/main/view');
const { OutputServer } = require('../src/main/server');
const { Projection, COMPETITOR_SECTIONS } = require('../src/main/projection');

// ---- start numbers ----
assert.strictEqual(C.numberKey(' 012 '), '12');
assert.strictEqual(C.numberKey(0), null, 'no number 0');
assert.strictEqual(C.numberKey('12a'), null);
assert.strictEqual(C.numberKey('12345'), null, 'at most 4 digits');
assert.deepStrictEqual(C.parseNumbers('12, 45 67;101 12 x7'), { numbers: ['12', '45', '67', '101'], invalid: ['x7'] });
assert.deepStrictEqual(C.parseNumbers(''), { numbers: [], invalid: [] });

// ---- DanS start list: keyed by DanS id; a number only when DanS has one (D-23, C-37) ----
const P = (name, surname, idt) => ({ name, surname, in_authority_id: idt ? { id: idt } : { id: null } });
const solo = { id: 's1', number: 7, club: 'Klub A', people: { Persons: [P('Jana', 'Nováková', '90000001')] } };
const couple = { id: 'c1', number: null, club: 'Klub B', people: { Couples: [{ partner1: P('Petr', 'Dvořák', '90000002'), partner2: P('Eva', 'Malá Veselá', '90000003') }] } };
const waiting = { id: 'w1', number: null, club: 'Klub C', people: { Persons: [P('Ivo', 'Beneš', '90000004')] } };
const team = { id: 't1', number: 9, name: 'Formace', people: {} };
assert.deepStrictEqual(C.dansPeople(solo), { kind: 'solo', people: [{ name: 'Jana', surname: 'Nováková', idt: '90000001' }] });
assert.strictEqual(C.dansPeople(couple).kind, 'couple');
assert.strictEqual(C.dansPeople(team), null, 'nothing to show for a team without people');
// the couple has no number on the start list yet; the round draw (DanS's own) has it. 'waiting' has none anywhere.
const draws = { r1: { competitors: [{ id: 'c1', number: 112 }, { id: 's1', number: 7 }] } };
const dans = C.fromStartlist([solo, couple, waiting, team], draws);
assert.deepStrictEqual([...dans.keys()], ['dans:s1', 'dans:c1', 'dans:w1']);
assert.strictEqual(dans.get('dans:c1').number, '112');
assert.strictEqual(dans.get('dans:w1').number, null, 'no number in DanS = no number here');
assert.strictEqual(dans.get('dans:c1').people[1].surname, 'Malá Veselá');
assert.deepStrictEqual(C.drawNumbers({ competitors: [{ number: 12 }, { number: 3 }, { number: 12 }, { number: null }] }), ['3', '12']);

// ---- merging with stored entries ----
const merged = C.mergeCompetitors(dans, {
  'dans:s1': { people: [{ name: 'Jana', surname: 'Nováková-Typed', idt: '90000001' }], photos: [{ file: 'a.jpg' }], main: 'a.jpg' },
  'm:x1': { number: '200', kind: 'couple', origin: 'phone', photos: [] },
  'm:x2': { number: '7', people: [{ name: 'Typed', surname: 'Seven' }] },
  'dans:gone': { photos: [{ file: 'g.jpg' }] },
});
assert.deepStrictEqual(merged.map((c) => c.number), ['7', '7', '112', '200', null, null], 'by number, then the ones without');
const byKey = Object.fromEntries(merged.map((c) => [c.key, c]));
assert.strictEqual(byKey['dans:s1'].people[0].surname, 'Nováková-Typed', 'typed names win');
assert.ok(byKey['dans:s1'].inDans && byKey['dans:s1'].stored);
assert.strictEqual(byKey['m:x1'].origin, 'phone');
assert.strictEqual(byKey['m:x1'].people.length, 2, 'a couple always gets two people');
assert.ok(byKey['dans:s1'].sameNumber && byKey['m:x2'].sameNumber, 'a shared number is pointed out');
assert.strictEqual(byKey['dans:gone'].origin, 'gone', 'stored data of a competitor no longer in the start list stays visible');
assert.strictEqual(C.findByNumber(merged, '7').key, 'dans:s1', 'the DanS competitor wins a shared number');
assert.strictEqual(C.findByNumber(merged, '5'), null);

// ---- typed entries move onto the DanS competitor once DanS gives that number ----
assert.deepStrictEqual(C.attachToDans(dans, {
  'm:p1': { number: '112', origin: 'phone', photos: [{ file: 'p.jpg' }] }, // phone photo for 112 -> the couple
  'm:p2': { number: '7', people: [{ name: 'Typed', surname: 'Seven' }] },  // typed names: stays separate
  'm:p3': { number: '300', photos: [] },                                   // DanS has no 300
}), [{ from: 'm:p1', to: 'dans:c1' }]);
assert.deepStrictEqual(C.attachToDans(dans, { 'm:p1': { number: '7' }, 'dans:s1': { photos: [] } }), [], 'target already has data');

// ---- screen names ----
assert.deepStrictEqual(C.screenName(byKey['dans:c1']), { first: '', last: 'Dvořák – Malá Veselá', surnames: ['Dvořák', 'Malá Veselá'] }, 'couple: surnames only');
assert.deepStrictEqual(C.screenName({ kind: 'solo', people: [{ name: 'Jana', surname: 'Nováková' }] }), { first: 'Jana', last: 'Nováková', surnames: ['Nováková'] });
assert.deepStrictEqual(C.screenName({ kind: 'solo', people: [{ name: 'Jana', surname: '' }] }), { first: '', last: 'Jana', surnames: ['Jana'] }, 'no surname: the name is the big line');
assert.strictEqual(C.screenName({ kind: 'solo', people: [] }).last, '');

// ---- ČSTS answers ----
assert.deepStrictEqual(C.parseCstsMember({ idt: 90000001, name: 'Jana', surname: 'Nováková', clubName: 'Klub A' }), { name: 'Jana', surname: 'Nováková', club: 'Klub A', idt: '90000001' });
assert.deepStrictEqual(C.parseCstsMember({ entity: { name: 'Jana', surname: 'Nováková' } }).surname, 'Nováková', 'wrapped in entity');
assert.strictEqual(C.parseCstsMember({}), null);
assert.deepStrictEqual(C.parseCstsAthlete({ collection: [{ name: 'Nováková Jana Marie', idt: 1 }] }), { surname: 'Nováková', name: 'Jana Marie', club: '', idt: '1', guessed: true });
assert.strictEqual(C.parseCstsAthlete({ collection: [] }), null);

// ---- store: entries saved by number before C-37 become typed entries ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-comp-'));
fs.writeFileSync(path.join(dir, 'competitors.json'), JSON.stringify({ 'ev-old': { 12: { origin: 'phone', photos: [] } } }));
const store = new Store(dir);
assert.deepStrictEqual(store.competitors.data['ev-old'], { 'm:12': { number: '12', origin: 'phone', photos: [] } });

// ---- store: per event, photos, cleanup ----
store.updateConfig({ eventId: 'ev-1' });
const src = path.join(dir, 'p.jpg'); fs.writeFileSync(src, 'jpeg');
const K = 'dans:s1';
const f1 = store.addCompetitorPhoto(K, src, { hash: 'h1' });
const f2 = store.addCompetitorPhoto(K, src, { hash: 'h2' });
assert.strictEqual(store.competitor(K).main, f1, 'first photo is main');
assert.ok(f1.startsWith('c-dans_s1-'), 'competitor photo files are marked, key made file-safe');
assert.ok(store.hasCompetitorPhotoHash(K, 'h2'));
store.setCompetitorMain(K, f2);
store.setCompetitorCrop(K, f2, { x: 10, y: 20, zoom: 2 });
assert.deepStrictEqual(store.competitor(K).photos.find((p) => p.file === f2).crop, { x: 10, y: 20, zoom: 2 });
const f3 = store.replaceCompetitorPhotoFile(K, f2, src, { resetCrop: true });
assert.strictEqual(store.competitor(K).main, f3, 'replacing the main photo keeps it main');
assert.strictEqual(store.competitor(K).photos.find((p) => p.file === f3).crop, null);
store.deleteCompetitorPhoto(K, f3);
assert.strictEqual(store.competitor(K).main, f1, 'deleting main falls back to the next');
// moving a typed entry onto a DanS competitor drops its own number
store.updateCompetitor('m:a', { number: '112', origin: 'phone', photos: [{ file: 'x.jpg' }], main: 'x.jpg' });
store.moveCompetitor('m:a', 'dans:c1');
assert.deepStrictEqual(store.competitor('dans:c1'), { photos: [{ file: 'x.jpg' }], main: 'x.jpg' });
assert.strictEqual(store.competitor('m:a'), null);
store.deleteCompetitor('dans:c1');
// another event does not see these
store.updateConfig({ eventId: 'ev-2' });
assert.strictEqual(store.competitor(K), null, 'competitors are per event');
store.cleanupFiles(new Set());
assert.ok(fs.existsSync(path.join(store.photoDir, f1)), 'cleanup keeps photos of other events');
assert.ok(!fs.existsSync(path.join(store.photoDir, f2)) && !fs.existsSync(path.join(store.photoDir, f3)), 'replaced/deleted files go');

// ---- the other day of a two-day championship: same dancer, other DanS id and other number, found by IDT (C-38) ----
store.updateConfig({ eventId: 'ev-1' });
store.updateCompetitor(K, { idts: ['90000001'] });
store.updateConfig({ eventId: 'ev-2' });
const sunday = { startlist: [{ id: 'z9', number: 41, people: { Persons: [P('Jana', 'Nováková', '90000001')] } }] };
let sun = competitorList(sunday, store);
assert.strictEqual(sun[0].borrowed, 'ev-1', 'Sunday shows the Saturday photo');
assert.strictEqual(sun[0].main, f1);
assert.strictEqual(sun[0].number, '41', 'with the Sunday number');
const own = store.addCompetitorPhoto('dans:z9', src, { hash: 'sun' });
sun = competitorList(sunday, store);
assert.ok(!sun[0].borrowed && sun[0].main === own, 'a photo added on Sunday wins');
assert.strictEqual(store.photosFromOtherEvent(['90000002']), null, 'no match for another IDT');
store.updateConfig({ eventId: 'ev-1' });

// ---- competitor projection state ----
const raw = { startlist: [solo, couple, waiting], draws };
store.updateConfig({ competitorScreen: { numbers: ['112', '7', '300'], mode: 'round', number: '5', title: 'Finále sólo' } });
let st = competitorState(null, raw, store);
assert.deepStrictEqual(st.screen.competitors.map((c) => c.number), [7, 112, 300], 'sorted; unknown 300 still gets a card');
assert.strictEqual(st.screen.competitors[0].photo, `/photos/${f1}`);
assert.strictEqual(st.screen.competitors[1].last, 'Dvořák – Malá Veselá');
assert.deepStrictEqual(st.screen.header, { number: '5', title: 'Finále sólo', titleEn: '', round: '' });
assert.ok(!JSON.stringify(st).includes('9000000'), 'no IDT reaches the output page');
// since D-27 (2026-11-22) the club is shown on screen; the IDT still never is
assert.strictEqual(st.screen.competitors[0].club, 'Klub A', 'the club reaches the output page');
store.updateConfig({ competitorScreen: { mode: 'spotlight', spotlight: '112' } });
st = competitorState(null, raw, store);
assert.strictEqual(st.screen.spotlight.number, 112);
store.updateConfig({ competitorScreen: { spotlight: '8' } });
assert.strictEqual(competitorState(null, raw, store).screen.spotlight, null, 'spotlight must be in the round');
assert.strictEqual(competitorList(raw, store).length, 3, 'the competitor without a number is listed too');

// ---- projection sections ----
const fakeServer = { publish() {} };
const pr = new Projection({ server: fakeServer, file: path.join(dir, 'pc.json'), sections: COMPETITOR_SECTIONS });
pr.setDraft(st); pr.push();
assert.deepStrictEqual(pr.changes(), []);
pr.setDraft({ ...st, screen: { ...st.screen, mode: 'round' } });
assert.deepStrictEqual(pr.changes(), ['Whole round / spotlight']);

// ---- phone upload routes (server.js handleUpload) ----
(async () => {
  let enabled = false; const received = [];
  const srv = new OutputServer({
    outputsDir: path.join(__dirname, '..', 'src', 'outputs'), photoDir: store.photoDir,
    upload: {
      enabled: () => enabled, key: () => 'k3y-ABC_123',
      page: path.join(__dirname, '..', 'src', 'phone', 'upload.html'),
      list: () => [{ number: 7, label: 'Jana Nováková' }],
      receive: async (number, buf) => { received.push([number, buf.length]); return { number: Number(number), label: 'x' }; },
    },
  });
  const { port } = await srv.listen(0, '127.0.0.1');
  const req = (method, p, { body = null, headers = {} } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
  try {
    assert.strictEqual((await req('GET', '/upload?key=k3y-ABC_123')).status, 403, 'switched off');
    enabled = true;
    assert.strictEqual((await req('GET', '/upload?key=wrong')).status, 403, 'wrong key');
    assert.strictEqual((await req('GET', '/upload')).status, 403, 'no key');
    const page = await req('GET', '/upload?key=k3y-ABC_123');
    assert.strictEqual(page.status, 200); assert.ok(page.body.includes('Startovní číslo'));
    assert.deepStrictEqual(JSON.parse((await req('GET', '/upload/list?key=k3y-ABC_123')).body), { competitors: [{ number: 7, label: 'Jana Nováková' }] });
    assert.strictEqual((await req('POST', '/upload/photo?key=k3y-ABC_123&number=7', { body: 'x', headers: { 'content-type': 'text/plain' } })).status, 415, 'images only');
    assert.strictEqual((await req('POST', '/upload/photo?key=k3y-ABC_123&number=7', { headers: { 'content-type': 'image/jpeg', 'content-length': String(21 * 1024 * 1024) } }).catch(() => ({ status: 413 }))).status, 413, 'too big');
    const ok = await req('POST', '/upload/photo?key=k3y-ABC_123&number=7', { body: Buffer.alloc(1000), headers: { 'content-type': 'image/jpeg' } });
    assert.strictEqual(ok.status, 200); assert.deepStrictEqual(received, [['7', 1000]]);
    assert.strictEqual((await req('POST', '/api/state')).status, 405, 'everything else stays GET only');
    assert.strictEqual((await req('GET', '/out/competitors.html')).status, 200);
    console.log('competitors: all tests passed');
  } finally { srv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
