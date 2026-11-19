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
const b = s.addPhoto('10000001', src, { hash: 'h2' });
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
console.log('OK');
