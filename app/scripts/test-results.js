'use strict';
// Results announcement (D-26) and club / sponsor (D-27), 2026-11-22: which round is the final, places from the
// final's draw, ties, Top 3 vs whole final, revealing from the last place, the state the results page draws, pushing
// only the results part, and club / sponsor from DanS and typed. Made-up names only (public repository).
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const R = require('../src/main/results');
const C = require('../src/main/competitors');
const { Store } = require('../src/main/store');
const { competitorState, competitorList, resultsState } = require('../src/main/view');
const { OutputServer } = require('../src/main/server');
const { Projection, COMPETITOR_SECTIONS } = require('../src/main/projection');

// ---- the final round: latest non-cancelled SkatingFinal; a redanced final has a cancelled first F ----
const comp = {
  id: 'k1', competition_number: 1, state: 'Finished',
  rounds: [
    { id: 'r1', abbreviation: 'R1', judging: 'SkatingElimination', state: 'Finished', logical_order: 1, physical_order: 1 },
    { id: 'f-old', abbreviation: 'F', judging: 'SkatingFinal', state: 'Cancelled', cancelled: 1, logical_order: 2, physical_order: 2 },
    { id: 'f', abbreviation: 'F', name: 'Finále', judging: 'SkatingFinal', state: 'Finished', finished: 1795281682398, logical_order: 2, physical_order: 3 },
  ],
};
assert.strictEqual(R.finalRound(comp).id, 'f');
assert.strictEqual(R.finalRound({ rounds: [comp.rounds[0]] }), null, 'no final yet');
assert.deepStrictEqual(R.resultsReady(comp).ok, true);
const running = { state: 'Running', rounds: [{ id: 'f', abbreviation: 'F', judging: 'SkatingFinal', state: 'InProgress', logical_order: 1, physical_order: 1 }] };
assert.strictEqual(R.resultsReady(running).ok, false, 'not before the final is finished');
assert.match(R.resultsReady(running).reason, /not finished/);
assert.strictEqual(R.resultsReady({ rounds: [] }).reason, 'No final in DanS');

// ---- places from the final's draw (shape verified on the venue DanS: ranking, ranking_to) ----
const entry = (id, number, ranking, rankingTo = null) => ({ id, number, ranking, ranking_to: rankingTo, completion: 'Losing', dances: [] });
const draw = { competitors: [entry('a', 28, 4), entry('b', 147, 1), entry('c', 196, 2), entry('d', 229, 5), entry('e', 269, 3), entry('f', 288, 6), entry('x', 300, null)] };
const places = R.placesFromDraw(draw);
assert.deepStrictEqual(places.map((p) => p.number), ['147', '196', '269', '28', '229', '288'], 'best first, unranked left out');
assert.strictEqual(R.placeLabel(1), '1.');
assert.strictEqual(R.placeLabel(2, 3), '2.–3.');

// Top 3 / whole final
assert.deepStrictEqual(R.placeGroups(places, 'top3').map((g) => g.label), ['1.', '2.', '3.']);
assert.deepStrictEqual(R.placeGroups(places, 'all').map((g) => g.label), ['1.', '2.', '3.', '4.', '5.', '6.']);

// ---- ties: share a place, revealed together; a tie at 3rd keeps both in Top 3 ----
const tied = R.placesFromDraw({ competitors: [entry('a', 1, 1), entry('b', 2, 2, 3), entry('c', 3, 2, 3), entry('d', 4, 4)] });
const tg = R.placeGroups(tied, 'top3');
assert.deepStrictEqual(tg.map((g) => g.label), ['1.', '2.–3.'], 'places 2 and 3 shared: one group');
assert.strictEqual(tg[1].entries.length, 2);
const tie3 = R.placeGroups(R.placesFromDraw({ competitors: [entry('a', 1, 1), entry('b', 2, 2), entry('c', 3, 3, 4), entry('d', 4, 3, 4), entry('e', 5, 5)] }), 'top3');
assert.deepStrictEqual(tie3.map((g) => g.label), ['1.', '2.', '3.–4.'], 'tie at 3rd: both are announced');
// the same place without ranking_to still reads as shared
assert.strictEqual(R.placeGroups(R.placesFromDraw({ competitors: [entry('a', 1, 2), entry('b', 2, 2)] }), 'all')[0].label, '2.–3.');

// ---- revealing: from the last place; the current one is the place revealed last ----
const groups = R.placeGroups(places, 'top3');
let l = R.ladder(groups, 0);
assert.deepStrictEqual([l.step, l.total, l.current, l.done], [0, 3, null, false]);
assert.ok(l.rows.every((r) => !r.revealed && !r.competitors.length), 'nothing shown before the first reveal');
l = R.ladder(groups, 1);
assert.strictEqual(l.current.label, '3.', 'third place first');
assert.deepStrictEqual(l.rows.map((r) => r.revealed), [false, false, true]);
l = R.ladder(groups, 3);
assert.strictEqual(l.current.label, '1.');
assert.strictEqual(l.done, true);
assert.strictEqual(R.ladder(groups, 99).step, 3, 'clamped to the places there are');
assert.strictEqual(R.ladder(groups, -2).step, 0);

// ---- club and sponsor: from the DanS start list; typed values win while not empty (D-27) ----
const P = (name, surname, idt) => ({ name, surname, in_authority_id: { id: idt } });
const startlist = [
  { id: 'a', number: 28, club: 'Klub A', sponsor: null, people: { Persons: [P('Jana', 'Nováková', '90000001')] } },
  { id: 'b', number: 147, club: ' Klub B ', sponsor: 'Firma s.r.o.', people: { Persons: [P('Eva', 'Malá', '90000002')] } },
  { id: 'c', number: 196, club: 'Klub C', people: { Persons: [P('Ivo', 'Beneš', '90000003')] } },
  { id: 'e', number: 269, club: 'Klub E', people: { Couples: [{ partner1: P('Petr', 'Dvořák', '90000004'), partner2: P('Lea', 'Černá', '90000005') }] } },
];
const dans = C.fromStartlist(startlist);
assert.strictEqual(dans.get('dans:b').club, 'Klub B', 'trimmed');
assert.strictEqual(dans.get('dans:b').sponsor, 'Firma s.r.o.');
assert.strictEqual(dans.get('dans:a').sponsor, '', 'no sponsor: empty');
let merged = C.mergeCompetitors(dans, { 'dans:a': { club: 'Typed klub' } });
assert.strictEqual(merged.find((c) => c.key === 'dans:a').club, 'Typed klub');
assert.strictEqual(merged.find((c) => c.key === 'dans:a').dansClub, 'Klub A', 'DanS value kept as the hint');
merged = C.mergeCompetitors(dans, { 'dans:b': { photos: [] } });
assert.strictEqual(merged.find((c) => c.key === 'dans:b').sponsor, 'Firma s.r.o.', 'nothing typed: DanS');

// ---- the state the results page draws, from a store ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-results-'));
const store = new Store(dir);
store.updateConfig({ eventId: 'ev1' });
store.updateCompetitor('dans:b', { sponsor: 'Typed sponsor' });
const raw = { competitions: [comp], startlist, results: { f: draw } };
const model = { competitions: [{ id: 'k1', number: 1, title: 'Dospělí Open SoLAT', titleEn: 'Adult Open Solo LAT' }] };
assert.strictEqual(resultsState(model, raw, store), null, 'nothing chosen yet');
store.updateConfig({ results: { competitionId: 'k1', roundId: 'f', scope: 'top3', step: 0 } });
let rs = resultsState(model, raw, store);
assert.deepStrictEqual(rs.header, { number: 1, title: 'Dospělí Open SoLAT', titleEn: 'Adult Open Solo LAT', round: 'Finále' });
assert.strictEqual(rs.total, 3);
assert.strictEqual(rs.current, null);
store.updateConfig({ results: { step: 3 } });
rs = resultsState(model, raw, store);
const winner = rs.current.competitors[0];
assert.deepStrictEqual([winner.number, winner.first, winner.last, winner.club, winner.sponsor, winner.place], [147, 'Eva', 'Malá', 'Klub B', 'Typed sponsor', '1.']);
const third = rs.rows[2].competitors[0];
assert.deepStrictEqual([third.kind, third.surnames, third.club], ['couple', ['Dvořák', 'Černá'], 'Klub E'], 'couple, found by DanS id');
// the window lists every place even before it is revealed
store.updateConfig({ results: { step: 0 } });
assert.ok(resultsState(model, raw, store, undefined, { step: Infinity }).rows.every((r) => r.revealed));
// whole final
store.updateConfig({ results: { scope: 'all', step: 1 } });
rs = resultsState(model, raw, store);
assert.strictEqual(rs.total, 6);
assert.strictEqual(rs.current.label, '6.');
// a number nobody has in the start list still gets a card with its number
assert.strictEqual(rs.current.competitors[0].number, 288);

// the competitor page cards carry club and sponsor too
store.updateConfig({ competitorScreen: { numbers: ['28', '147'] } });
const cs = competitorState(null, raw, store);
assert.deepStrictEqual(cs.screen.competitors.map((c) => [c.number, c.club, c.sponsor]), [[28, 'Klub A', ''], [147, 'Klub B', 'Typed sponsor']]);
assert.ok(cs.results, 'results travel in the competitor projection state');
// the final's numbers count as DanS numbers (start list without a number, final draw with one)
const noNum = [{ ...startlist[0], number: null }];
assert.strictEqual(competitorList({ startlist: noNum, results: { f: draw } }, store).find((c) => c.key === 'dans:a').number, '28');

// ---- Projection.pushKeys: Reveal pushes only the results part ----
const server = new OutputServer({ outputsDir: dir, photoDir: dir });
const proj = new Projection({ server, file: path.join(dir, 'pushed-c.json'), sections: COMPETITOR_SECTIONS });
proj.setDraft({ screen: { competitors: [1] }, results: null, theme: { a: 1 } });
proj.push();
proj.setDraft({ screen: { competitors: [1, 2] }, results: { step: 1 }, theme: { a: 1 } });
assert.deepStrictEqual(proj.changes(), ['Competitors', 'Results']);
assert.strictEqual(proj.pushKeys(['results']), true);
assert.deepStrictEqual(proj.pushed.results, { step: 1 }, 'results on screen');
assert.deepStrictEqual(proj.pushed.screen.competitors, [1], 'competitor edits in preparation stay off air');
assert.deepStrictEqual(proj.changes(), ['Competitors']);
assert.strictEqual(proj.pushKeys(['results']), false, 'nothing new to push');
// with nothing pushed before, the whole draft goes
const proj2 = new Projection({ server, file: path.join(dir, 'pushed-c2.json'), sections: COMPETITOR_SECTIONS });
proj2.setDraft({ screen: { competitors: [5] }, results: { step: 2 } });
proj2.pushKeys(['results']);
assert.deepStrictEqual(proj2.pushed.screen.competitors, [5]);

store.flush?.();
console.log('results: all tests passed');
