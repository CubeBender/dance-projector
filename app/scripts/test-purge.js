'use strict';
// Competitor photos are not kept (D-30), 2026-11-22: photos go N days after the later of (event end, photo added);
// once an event is over by N days and no photo is left, everything typed about its competitors goes; events with an
// unknown date keep everything; judges are never touched. Made-up data only (public repository).
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Store } = require('../src/main/store');

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 30, 12); // 30 Nov 2026
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-purge-'));
const s = new Store(dir);
const photo = (key, at) => ({ file: `c-${key}-${at}-abcd.jpg`, hash: null, crop: null });

// past event: ended 20 Nov (10 days ago); upcoming event: ends 5 Dec; unknown event: no date
s.competitors.data = {
  past: {
    'dans:a': { photos: [photo('a', NOW - 15 * DAY)], main: `c-a-${NOW - 15 * DAY}-abcd.jpg`, club: 'Klub' },
    'm:b': { name: 'Typed', surname: 'Child', idts: ['90000009'] },                  // typed only, no photo
    'dans:c': { photos: [photo('c', NOW - DAY)] },                                    // added after the event, 1 day ago
  },
  upcoming: { 'dans:d': { photos: [photo('d', NOW - 10 * DAY)] } },                   // collected 10 days early
  unknown: { 'dans:e': { photos: [photo('e', NOW - 40 * DAY)] } },
  _none: { 'm:f': { photos: [photo('f', NOW - 4 * DAY), photo('f', NOW - DAY)], main: `c-f-${NOW - 4 * DAY}-abcd.jpg` } },
};
s.judges.data = { 90000001: { name: 'Judge', photos: [{ file: `j-90000001-${NOW - 400 * DAY}-x.jpg` }] } };
const ends = { past: Date.UTC(2026, 10, 21), upcoming: Date.UTC(2026, 11, 6) };

const r = s.purgeCompetitors({ days: 3, now: NOW, eventEnd: (k) => ends[k] ?? null });
const C = s.competitors.data;
assert.strictEqual(C.past['dans:a'], undefined, 'old photo of a past event: gone, and with it the stored entry');
assert.strictEqual(C.past['m:b'], undefined, 'typed details of a past event: gone');
assert.strictEqual(C.past['dans:c'].photos.length, 1, 'a photo added after the event counts from when it was added');
assert.strictEqual(C.upcoming['dans:d'].photos.length, 1, 'collected early for an event still to come: kept');
assert.strictEqual(C.unknown['dans:e'].photos.length, 1, 'event date unknown: kept');
assert.deepStrictEqual(C._none['m:f'].photos.map((p) => p.file), [`c-f-${NOW - DAY}-abcd.jpg`], 'no event: by age alone');
assert.strictEqual(C._none['m:f'].main, `c-f-${NOW - DAY}-abcd.jpg`, 'main photo moves to a kept one');
assert.strictEqual(s.judges.data[90000001].photos.length, 1, 'judges are never touched');
assert.deepStrictEqual(r, { photos: 2, competitors: 2 });

// three days later the late photo goes too, and the event disappears from competitors.json
s.purgeCompetitors({ days: 3, now: NOW + 3 * DAY, eventEnd: (k) => ends[k] ?? null });
assert.strictEqual(C.past, undefined, 'nothing left of the past event');
// a longer setting keeps more
const s2 = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'dp-purge-')));
s2.competitors.data = { past: { 'dans:a': { photos: [photo('a', NOW - 15 * DAY)] } } };
s2.purgeCompetitors({ days: 14, now: NOW, eventEnd: () => Date.UTC(2026, 10, 21) });
assert.strictEqual(s2.competitors.data.past['dans:a'].photos.length, 1, '14 days: still kept');

// the files themselves go with cleanupFiles (a photo on screen is kept by the caller passing it in `keep`)
fs.writeFileSync(path.join(s.photoDir, `c-a-${NOW - 15 * DAY}-abcd.jpg`), 'x');
fs.writeFileSync(path.join(s.photoDir, `c-c-${NOW - DAY}-abcd.jpg`), 'x');
s.cleanupFiles();
assert.ok(!fs.existsSync(path.join(s.photoDir, `c-a-${NOW - 15 * DAY}-abcd.jpg`)), 'file of a purged photo removed');
// ---- the app's own offline copies and heat logs (C-58); only files the app wrote, in its own folder ----
const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-purge-'));
const s3 = new Store(d3);
const snap = (id, date, days) => fs.writeFileSync(s3.snapshotFile(id), JSON.stringify({ event: { id, date, days }, startlist: [] }));
snap('ev-past', '2026-11-21', 2);      // ended 23 Nov 00:00 local
snap('ev-soon', '2026-12-05', 1);
snap('ev-nodate', null, 1);
snap('ev-chosen', '2026-11-01', 1);    // the event chosen now: automatic mode would write it again at once
snap('ev-memo', '2026-12-30', 1);      // the remembered end (eventEnd) wins over the date inside the copy
fs.writeFileSync(path.join(d3, 'cache', 'broken.json'), '{');
fs.mkdirSync(path.join(d3, 'heatlog'));
for (const f of ['2026-11-21.jsonl', '2026-11-29.jsonl', 'notes.txt']) fs.writeFileSync(path.join(d3, 'heatlog', f), '');
const now3 = new Date(2026, 10, 30, 12).getTime();
const r3 = s3.purgeCollected({ days: 3, now: now3, keepEvent: 'ev-chosen', eventEnd: (k) => (k === 'ev-memo' ? new Date(2026, 10, 2).getTime() : null) });
const left = fs.readdirSync(path.join(d3, 'cache')).filter((f) => f.endsWith('.json')).sort();
assert.deepStrictEqual(left, ['broken.json', 'ev-chosen.json', 'ev-nodate.json', 'ev-soon.json'], 'past copies gone; upcoming, undated, chosen and unreadable kept');
assert.deepStrictEqual(fs.readdirSync(path.join(d3, 'heatlog')).sort(), ['2026-11-29.jsonl', 'notes.txt'], 'old heat log gone, other files untouched');
assert.deepStrictEqual(r3, { offline: 2, heatlogs: 1 });

s.flush(); s2.flush(); s3.flush();
console.log('purge: all tests passed');
