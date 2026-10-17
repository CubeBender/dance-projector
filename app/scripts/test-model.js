'use strict';
// Checks the model against the anonymised sample (made from the Pardubice scouting event; heats, judge letters
// and allocation are unchanged from the real data, which was verified by hand on 2026-10-17).
const assert = require('assert');
const path = require('path');
const { buildModel, buildHeats } = require('../src/main/model');
const { assertAllowed } = require('../src/main/dans');

const raw = require(path.join(__dirname, '..', 'fixtures', 'sample.json'));
const m = buildModel(raw, { runningStates: ['InProgress'] });

// allow-list
for (const bad of ['/competitions/results/deliverCompetition', '/events/x/report/deliver', '/stop',
  '/rounds/1f1c9b93-8ff2-6470-8b73-ff36bfb294d1/draw', '/events/1f1c9b49-6b36-6e7d-8782-ff36bfb294d1/judges/../result/deliver']) {
  assert.throws(() => assertAllowed(bad), `should refuse ${bad}`);
}
assertAllowed('/rounds/1f1c9b93-8ff2-6470-8b73-ff36bfb294d1/draw/competitors');

// no PINs anywhere
assert(!JSON.stringify(raw.judges).includes('"pin"'), 'judge PINs must not be in the fixture');

const c1 = m.competitions.find((c) => c.number === 1);
assert.strictEqual(c1.round.name, 'Finále');
assert.deepStrictEqual(c1.judges.map((j) => j.letter), ['B', 'H', 'L', 'N', 'R', 'U', 'Y']);
assert.deepStrictEqual(c1.round.dances.map((d) => d.abbr), ['W', 'C', 'Po']);

const c3 = m.competitions.find((c) => c.number === 3);
assert.strictEqual(c3.judges.length, 9);
const h3 = buildHeats(m, c3, raw.draws[c3.round.id]);
assert.deepStrictEqual(h3.dances[0].heats.map((h) => h.competitors.map((x) => x.number)),
  [[1, 2, 4, 5, 8, 9, 10, 13], [3, 6, 7, 11, 12, 14, 15, 16]]);
assert(h3.dances[0].heats[0].competitors[0].name.length > 3, 'competitor names resolved');

// English titles and dance names
assert.strictEqual(c3.titleEn, 'Juvenile I E Solo Combination');
assert.strictEqual(c1.titleEn, 'Under 8 E Solo Combination');
assert.strictEqual(c1.round.dances[1].nameCs, 'Cha-cha');
assert.strictEqual(c1.round.dances[1].nameEn, 'Cha-cha-cha');

// whole floor vs split floor
const os = require('os'); const fs = require('fs');
const { Store } = require('../src/main/store');
const { outputState } = require('../src/main/view');
const st = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'dp-view-')));
st.cfg.slots.A.competitionId = c3.id; st.cfg.slots.B.competitionId = c1.id;
let out = outputState(m, raw, st, { connected: true });
assert.strictEqual(out.split, false);
assert.strictEqual(out.slots.A.label, '', 'no side label on a whole floor');
assert.strictEqual(out.slots.A.color, st.cfg.wholeColor);
assert.strictEqual(out.slots.B.competition, null, 'slot B unused on a whole floor');
st.cfg.split = true;
out = outputState(m, raw, st, { connected: true });
assert.strictEqual(out.slots.A.label, 'Levá strana');
assert.strictEqual(out.slots.B.competition.number, 1);
assert.deepStrictEqual(out.slots.A.competition.judges[0].crop, { x: 50, y: 30, zoom: 1 });

console.log('competitions', m.competitions.length, '| c3 title:', c3.title, '|', c3.titleShort);
console.log('c3 heat 1:', h3.dances[0].heats[0].competitors.map((x) => `${x.number} ${x.name}`).join(', '));
console.log('running:', m.competitions.filter((c) => c.running).map((c) => c.number));
console.log('OK');
