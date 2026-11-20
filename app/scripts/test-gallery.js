'use strict';
// Judge gallery (2026-11-19): file name parsing, migration of old entries, several photos per judge,
// main photo, per-photo crop, and what the output pages get. Made-up names only (public repository).
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { parseFileName, migrateEntry, mainPhoto, sortForImport } = require('../src/main/gallery');
const { Store } = require('../src/main/store');
const { judgeView } = require('../src/main/view');

// ---- file names "IDT_Surname_Name[ Number].ext" ----
assert.deepStrictEqual(parseFileName('10000001_Nováková_Jana.jpg'), { idt: '10000001', surname: 'Nováková', name: 'Jana', n: 0 });
assert.deepStrictEqual(parseFileName('10000002_Dvořák_Petr 03.JPEG'), { idt: '10000002', surname: 'Dvořák', name: 'Petr', n: 3 });
assert.deepStrictEqual(parseFileName('10000003_Malá Veselá_Eva.PNG'), { idt: '10000003', surname: 'Malá Veselá', name: 'Eva', n: 0 }, 'surname with a space');
assert.deepStrictEqual(parseFileName('10000004_Svoboda_Jan Pavel 12.webp'), { idt: '10000004', surname: 'Svoboda', name: 'Jan Pavel', n: 12 }, 'two first names');
assert.strictEqual(parseFileName('notes.txt'), null);
assert.strictEqual(parseFileName('Nováková Jana.jpg'), null, 'no IDT');
assert.strictEqual(parseFileName('10000001_Nováková.jpg'), null, 'no name part');
// decomposed diacritics (as some file systems store them) come out composed
assert.strictEqual(parseFileName('10000001_Nováková_Jana.jpg').surname, 'Nováková');
const order = sortForImport([{ name: '10000002_Dvořák_Petr 02.jpg' }, { name: '10000002_Dvořák_Petr 01.jpg' }, { name: 'x.txt' }]);
assert.deepStrictEqual(order.filter((o) => o.info).map((o) => o.f.name), ['10000002_Dvořák_Petr 01.jpg', '10000002_Dvořák_Petr 02.jpg']);

// ---- migration from the single-photo shape ----
assert.deepStrictEqual(migrateEntry({ displayName: 'Ing. X', photo: 'a.jpg', crop: { x: 1, y: 2, zoom: 1 }, normalized: true }),
  { displayName: 'Ing. X', normalized: true, photos: [{ file: 'a.jpg', crop: { x: 1, y: 2, zoom: 1 } }], main: 'a.jpg' });
assert.deepStrictEqual(migrateEntry({}), { photos: [] });
assert.strictEqual(mainPhoto(migrateEntry({ photos: [{ file: 'b.jpg' }], main: 'gone.jpg' })).file, 'b.jpg', 'missing main falls back to the first');

// ---- store: several photos, main, crop per photo, delete ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-gal-'));
fs.writeFileSync(path.join(dir, 'judges.json'), JSON.stringify({ 10000009: { photo: 'old.jpg', crop: null, normalized: true } }));
let s = new Store(dir);
assert.deepStrictEqual(s.judge('10000009').photos, [{ file: 'old.jpg', crop: null }], 'old entry migrated on load');
const src = path.join(dir, 'p.jpg'); fs.writeFileSync(src, 'jpeg');
s.ensureJudge('10000001', { name: 'Jana', surname: 'Nováková' });
const a = s.addPhoto('10000001', src, { hash: 'h1' });
let b = s.addPhoto('10000001', src, { hash: 'h2' });
assert.strictEqual(s.judge('10000001').main, a, 'first photo becomes main');
assert.ok(s.hasPhotoHash('10000001', 'h2') && !s.hasPhotoHash('10000001', 'h3'));
s.setMainPhoto('10000001', b);
s.setPhotoCrop('10000001', b, { x: 40, y: 20, zoom: 2 });
s.ensureJudge('10000001', { name: 'Other', surname: 'Name' });
assert.strictEqual(s.judge('10000001').name, 'Jana', 'import does not overwrite names already in the gallery');
// judgeView: gallery name and the main photo with its own crop
let v = judgeView({ fedId: '10000001', letter: 'C', name: 'Jana', surname: 'Novakova', country: 'CZE' }, s);
assert.strictEqual(v.name, 'Jana Nováková', 'gallery spelling wins over DanS');
assert.ok(v.photo.endsWith(b)); assert.deepStrictEqual(v.crop, { x: 40, y: 20, zoom: 2 });
s.updateJudge('10000001', { displayName: 'Ing. Jana Nováková' });
assert.strictEqual(judgeView({ fedId: '10000001', letter: 'C' }, s).name, 'Ing. Jana Nováková');
// replacing a photo's file (re-encode / rotate) keeps its place, main status and hash; rotate resets the crop
assert.strictEqual(s.photoByHash('10000001', 'h2').file, b);
const b2 = s.replacePhotoFile('10000001', b, src, { resetCrop: true, enc: 2 });
assert.notStrictEqual(b2, b, 'new file name');
assert.strictEqual(s.judge('10000001').main, b2, 'still the main photo');
assert.deepStrictEqual(s.photoByHash('10000001', 'h2'), { file: b2, hash: 'h2', crop: null, enc: 2 });
assert.throws(() => s.replacePhotoFile('10000001', 'nope.jpg', src), /not found/);
s.setPhotoCrop('10000001', b2, { x: 40, y: 20, zoom: 2 });
const b3 = s.replacePhotoFile('10000001', b2, src, { enc: 2 });
assert.deepStrictEqual(s.photoByHash('10000001', 'h2').crop, { x: 40, y: 20, zoom: 2 }, 'crop kept when not asked to reset');
b = b3; // the rest of the test works with the current file of the second photo
// deleting the main photo makes the remaining one main; the file stays until cleanup
s.deletePhoto('10000001', b);
assert.strictEqual(s.judge('10000001').main, a);
assert.ok(fs.existsSync(path.join(s.photoDir, b)));
s.cleanupFiles();
assert.ok(!fs.existsSync(path.join(s.photoDir, b)) && fs.existsSync(path.join(s.photoDir, a)));
// a judge from DanS without a gallery entry still shows its DanS name, no photo
v = judgeView({ fedId: '10000077', letter: 'K', name: 'Petr', surname: 'Dvořák' }, s);
assert.strictEqual(v.name, 'Petr Dvořák'); assert.strictEqual(v.photo, null);
s.flush();
s = new Store(dir);
assert.strictEqual(s.judge('10000001').photos.length, 1, 'persisted');

// ---- own selection without DanS (D-19) ----
const { toggleManual, nextLetter, cleanLetter } = require('../src/main/panels');
const { outputState } = require('../src/main/view');
let sel = toggleManual([], '10000001');
sel = toggleManual(sel, '10000002');
assert.deepStrictEqual(sel, [{ fedId: '10000001', letter: 'A' }, { fedId: '10000002', letter: 'B' }]);
assert.strictEqual(nextLetter([{ letter: 'A' }, { letter: 'C' }]), 'B', 'fills gaps');
assert.strictEqual(nextLetter(Array.from({ length: 26 }, (_, i) => ({ letter: String.fromCharCode(65 + i) }))), 'AA');
assert.deepStrictEqual(toggleManual(sel, '10000001'), [{ fedId: '10000002', letter: 'B' }], 'second click removes');
assert.strictEqual(cleanLetter(' k-1x '), 'K1X'); assert.strictEqual(cleanLetter('abcd'), 'ABC');
s.ensureJudge('10000002', { name: 'Petr', surname: 'Dvořák' });
s.updateConfig({ slots: { A: { source: 'manual' } }, manualPanels: { A: { number: '7', title: 'Finále Senioři', judges: [{ fedId: '10000002', letter: 'B' }, { fedId: '10000001', letter: 'A' }, { fedId: '19999999', letter: 'C' }] } } });
// no DanS data at all (model null): the own selection is still on screen
let out = outputState(null, {}, s, { connected: false });
const comp = out.slots.A.competition;
assert.ok(comp.manual); assert.strictEqual(comp.number, '7'); assert.strictEqual(comp.title, 'Finále Senioři'); assert.strictEqual(comp.round, null);
assert.deepStrictEqual(comp.judges.map((j) => `${j.letter} ${j.name}`), ['B Petr Dvořák', 'A Ing. Jana Nováková'], 'sorted by surname (default); unknown IDT dropped');
// order on screen per side (panels.js sortJudges)
const shownOrder = (mode, ids) => { s.updateConfig({ slots: { A: { judgeSort: mode, order: ids || [] } } }); return outputState(null, {}, s, {}).slots.A.competition.judges.map((j) => j.letter); };
assert.deepStrictEqual(shownOrder('letter'), ['A', 'B']);
assert.deepStrictEqual(shownOrder('firstname'), ['A', 'B'], 'Ing. Jana before Petr');
assert.deepStrictEqual(shownOrder('custom', ['10000001', '10000002']), ['A', 'B']);
assert.deepStrictEqual(shownOrder('custom', ['10000002']), ['B', 'A'], 'judges missing from the custom list go last');
assert.deepStrictEqual(shownOrder('nonsense'), ['B', 'A'], 'unknown mode falls back to surname');
s.updateConfig({ slots: { A: { judgeSort: 'surname', order: [] } } });
const { sortJudges, moveInOrder } = require('../src/main/panels');
const czech = sortJudges([{ surname: 'Čermák' }, { surname: 'Chalupa' }, { surname: 'Hora' }, { surname: 'Cibulka' }, { surname: 'Říha' }, { surname: 'Rada' }], 'surname');
assert.deepStrictEqual(czech.map((j) => j.surname), ['Cibulka', 'Čermák', 'Hora', 'Chalupa', 'Rada', 'Říha'], 'Czech alphabet: Č after C, CH after H');
assert.deepStrictEqual(moveInOrder(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
assert.deepStrictEqual(moveInOrder(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'], 'first cannot move up');
assert.ok(comp.judges.find((j) => j.letter === 'A').photo, 'gallery main photo');
// a DanS side without data is simply empty
s.updateConfig({ slots: { A: { source: 'dans' } } });
assert.strictEqual(outputState(null, {}, s, {}).slots.A.competition, null);
// deleting a judge removes the gallery entry and the place in the own selection
s.deleteJudge('10000001');
assert.deepStrictEqual(s.judge('10000001'), {});
assert.deepStrictEqual(s.cfg.manualPanels.A.judges.map((j) => j.fedId), ['10000002', '19999999']);
s.updateConfig({ slots: { A: { source: 'manual' } } });
assert.deepStrictEqual(outputState(null, {}, s, {}).slots.A.competition.judges.map((j) => j.letter), ['B']);
console.log('OK');
