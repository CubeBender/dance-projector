'use strict';
// Heat tracking (D-29), 2026-11-22: which heat is on the floor from the judges' marks, with a margin of error for a
// judge lagging behind or crossing a wrong number, the operator's Next heat / Back, and the poller reading marks of
// running rounds. Made-up ids and numbers only (public repository); the mark shapes are those seen on the venue DanS.
const assert = require('assert');
const T = require('../src/main/heattrack');
const { Poller } = require('../src/main/poller');

// ---- a round: two dances (C, R), three heats of four each, nine judges A–I ----
const JUDGES = 'ABCDEFGHI'.split('');
const round = (over = {}) => ({
  id: 'r1', judge_count: 9,
  judges: JUDGES.map((l) => ({ person: 'p' + l, round_dance: null, assessment_state: 'Unknown' })),
  dances: [
    { id: 'dC', dance: 'cha', dance_order: 1, state: 'Active', heat_count: 3, completed_at: null },
    { id: 'dX', dance: 'samba', dance_order: 2, state: 'Suppressed', heat_count: 3, completed_at: null }, // left out
    { id: 'dR', dance: 'rumba', dance_order: 3, state: 'Active', heat_count: 3, completed_at: null },
  ],
  ...over,
});
// competitor k (0–11) dances heat floor(k/4)+1 in C and the reverse order in R; dances[1] is the suppressed samba
const draw = { competitors: Array.from({ length: 12 }, (_, k) => ({
  id: 'c' + k, number: 100 + k,
  dances: [{ heat: Math.floor(k / 4) + 1 }, { heat: 1 }, { heat: 3 - Math.floor(k / 4) }],
})) };
const names = (id) => ({ cha: { abbr: 'C', name: 'Chachacha' }, rumba: { abbr: 'R', name: 'Rumba' } }[id] || {});
const plan = T.heatPlan(round(), draw, names);

assert.deepStrictEqual(plan.dances.map((d) => d.abbr), ['C', 'R'], 'suppressed dance left out');
assert.deepStrictEqual(plan.dances[0].heats.map((h) => h.competitors.map((c) => c.number)), [[100, 101, 102, 103], [104, 105, 106, 107], [108, 109, 110, 111]]);
assert.deepStrictEqual(plan.dances[1].heats[0].competitors.map((c) => c.number), [108, 109, 110, 111], 'heats per dance, by the draw index of the dance');
// a dance with no draw yet: heats from heat_count, so Next heat can still step through them
assert.strictEqual(T.heatPlan(round(), null, names).dances[0].heats.length, 3);

// marks as /rounds/{r}/marks sends them
const cross = (dance, comp, judge, value = { Cross: true }) => ({ target: { Competitor: { round_dance_id: dance, judge, competitor_id: comp, component: null } }, value, suppressed: false, overridden: false });
const submitted = (dance, judge) => ({ target: { DanceCompletion: { round_id: 'r1', round_dance_id: dance, judge } }, value: 'Empty', suppressed: false });
// judges `who` each cross one competitor of heat h (0-based) of dance C
const heatC = (h, who) => who.split('').map((j, i) => cross('dC', 'c' + (h * 4 + (i % 4)), j));

// ---- quorum: a third of the judges, at least 2 ----
assert.deepStrictEqual([1, 3, 5, 7, 9, 11].map(T.quorumFor), [1, 2, 2, 3, 3, 4]);

// ---- values that don't count: a cross taken back, "Empty", suppressed ----
assert.strictEqual(T.markCounts(cross('dC', 'c0', 'A', { Cross: false })), false);
assert.strictEqual(T.markCounts(cross('dC', 'c0', 'A', 'Empty')), false);
assert.strictEqual(T.markCounts({ ...cross('dC', 'c0', 'A'), suppressed: true }), false);
assert.strictEqual(T.markCounts(cross('dC', 'c0', 'A')), true);

// ---- the tracker over a round ----
const t = new T.RoundTracker('r1');
let v;
const feed = (marks, r = round(), at = Date.now()) => { t.update(T.heatPlan(r, draw, names), r, marks, at); v = t.view(); return v; };

feed([]);
assert.deepStrictEqual([v.now.dance, v.now.heat, v.next.heat, v.source], ['C', 1, 2, 'start'], 'nothing yet: the first heat');

// heat 1: five judges cross – heat 1 confirmed
let marks = heatC(0, 'ABCDE');
feed(marks);
assert.deepStrictEqual([v.now.heat, v.source], [1, 'dans']);

// a WRONG NUMBER: one judge crosses somebody in heat 3 while heat 1 dances – the position doesn't move
marks = [...marks, cross('dC', 'c9', 'F')];
feed(marks);
assert.strictEqual(v.now.heat, 1, 'one judge alone never moves the heat');
assert.strictEqual(v.dances[0].heats[2].marked, 1, 'but the window shows the stray cross');

// heat 2 starts: three judges (the quorum) cross there, while judge G is still finishing heat 1 (LAGGING)
marks = [...marks, ...heatC(1, 'ABC'), cross('dC', 'c3', 'G')];
feed(marks);
assert.deepStrictEqual([v.now.heat, v.next.heat], [2, 3], 'a quorum on heat 2 moves on; a lagging judge does not hold it back');
assert.deepStrictEqual(v.dances[0].heats.map((h) => h.state), ['done', 'now', 'next']);

// two judges taking their crosses in heat 2 back does not pull the position back (forward only)
marks = marks.filter((m) => !(m.target.Competitor?.competitor_id === 'c4' || m.target.Competitor?.competitor_id === 'c5'));
feed(marks);
assert.strictEqual(v.now.heat, 2, 'noise never moves back');

// ---- the operator: Back holds until the marks move PAST where they were ----
t.move(-1); v = t.view();
assert.deepStrictEqual([v.now.heat, v.source], [1, 'operator'], 'Back');
feed(marks);
assert.strictEqual(v.now.heat, 1, 'the same marks do not undo Back');
marks = [...marks, ...heatC(2, 'DEFG')];
feed(marks);
assert.deepStrictEqual([v.now.heat, v.source], [3, 'dans'], 'new evidence (heat 3) takes over again');
assert.strictEqual(v.next.dance, 'R', 'after the last heat of C comes heat 1 of R');

// Next ahead of the marks holds until the marks catch up and pass
t.move(1); v = t.view();
assert.deepStrictEqual([v.now.dance, v.now.heat, v.source], ['R', 1, 'operator']);
feed(marks);
assert.deepStrictEqual([v.now.dance, v.now.heat], ['R', 1]);

// ---- a dance is over: a quorum of judges submitted it ----
const t2 = new T.RoundTracker('r1');
const r0 = round();
t2.update(plan, r0, [...heatC(2, 'ABCD'), submitted('dC', 'A'), submitted('dC', 'B')]);
assert.strictEqual(t2.view().now.dance, 'C', 'two submissions are not a quorum of nine');
t2.update(plan, r0, [...heatC(2, 'ABCD'), submitted('dC', 'A'), submitted('dC', 'B'), submitted('dC', 'C')]);
assert.deepStrictEqual([t2.view().now.dance, t2.view().now.heat], ['R', 1], 'three judges submitted C: rumba heat 1');
assert.match(t2.view().reason, /submitted C/);

// ---- without marks (not automatic mode): DanS finishing a dance moves it; the tablets too ----
const t3 = new T.RoundTracker('r1');
const done = round({ dances: round().dances.map((d) => (d.id === 'dC' ? { ...d, completed_at: 1 } : d)) });
t3.update(T.heatPlan(done, draw, names), done, null);
assert.deepStrictEqual([t3.view().now.dance, t3.view().now.heat], ['R', 1], 'C finished in DanS');
const tablets = round({ judges: JUDGES.map((l, i) => ({ person: 'p' + l, round_dance: i < 3 ? 'dR' : 'dC' })) });
const t4 = new T.RoundTracker('r1');
t4.update(T.heatPlan(tablets, draw, names), tablets, null);
assert.strictEqual(t4.view().now.dance, 'R', 'three tablets on R');
// every dance finished: the last heat, nothing next
const all = round({ dances: round().dances.map((d) => ({ ...d, completed_at: 1 })) });
const t5 = new T.RoundTracker('r1');
t5.update(T.heatPlan(all, draw, names), all, null);
assert.deepStrictEqual([t5.view().now.dance, t5.view().now.heat, t5.view().next, t5.view().roundDone], ['R', 3, null, true]);

// ---- following the marks switched off: only the operator moves it ----
const t6 = new T.RoundTracker('r1');
t6.setAuto(false);
t6.update(plan, r0, heatC(2, 'ABCDE'));
assert.strictEqual(t6.view().now.heat, 1, 'auto off: marks ignored');
t6.move(1);
assert.strictEqual(t6.view().now.heat, 2);
t6.setAuto(true);
assert.strictEqual(t6.view().now.heat, 2, 'switching back on keeps the operator position until new evidence');
t6.update(plan, r0, [...heatC(2, 'ABCDE'), ...heatC(0, 'F')]);
assert.strictEqual(t6.view().now.heat, 2);

// ---- steps stop at both ends of the round ----
assert.deepStrictEqual(T.step(plan, { d: 0, h: 0 }, -1), { d: 0, h: 0 });
assert.deepStrictEqual(T.step(plan, { d: 1, h: 2 }, 1), { d: 1, h: 2 });
assert.strictEqual(T.nextOf(plan, { d: 1, h: 2 }), null);

// ---- "crossing now": marks first seen in a later read, within 20 s ----
const t7 = new T.RoundTracker('r1');
t7.update(plan, r0, heatC(0, 'AB'), 1000);              // first read: old news
t7.update(plan, r0, [...heatC(0, 'AB'), ...heatC(1, 'CD')], 3000);
assert.deepStrictEqual(t7.recentJudges(1, 0), []);
assert.deepStrictEqual(t7.recentJudges(0, 1), ['C', 'D']);
assert.deepStrictEqual(t7.recentJudges(0, 0), [], 'marks of the first read are not "now"');
t7.update(plan, r0, [...heatC(0, 'AB'), ...heatC(1, 'CD')], 30000);
assert.deepStrictEqual(t7.recentJudges(0, 1), [], 'older than 20 s');

// ---- the poller: marks of running rounds every poll, the draw once ----
(async () => {
  const calls = [];
  const fake = {
    indexes: async () => ({}), competitions: async () => [{ id: 'k1', rounds: [{ id: 'r1', state: 'InProgress' }] }],
    judges: async () => [], allocation: async () => [], startlist: async () => [],
    draw: async (e, r) => { calls.push('draw ' + r); return draw; },
    marks: async (e, r) => { calls.push('marks ' + r); return heatC(0, 'AB'); },
  };
  const p = new Poller({ dans: fake });
  p.event = { id: 'ev1' };
  p.liveRounds = () => ['r1'];
  await p.tick();
  await p.tick();
  assert.deepStrictEqual(calls, ['draw r1', 'marks r1', 'marks r1'], 'draw once, marks every poll');
  assert.strictEqual(p.raw.live.r1.marks.length, 2);
  // a draw read before (Load from DanS round) survives the full read every 15 s
  p.raw.draws.other = { competitors: [] };
  p.lastSlow = 0;
  await p.tick();
  assert.ok(p.raw.draws.other && p.raw.draws.r1, 'draws are kept across a full read');
  console.log('heats: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
