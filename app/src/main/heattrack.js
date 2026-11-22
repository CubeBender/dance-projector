'use strict';
// Which heat is on the floor now, and which one is next (decision D-29).
//
// DanS has no "current heat". It knows when a whole DANCE is finished (round dance completed_at, set once every judge
// has submitted it), and it has every judge's marks (GET /rounds/{r}/marks). Judges cross competitors while they
// watch them, so the heat whose competitors are being crossed is the heat being danced. Marks carry no time in the
// API, so the app reads them on every poll (automatic mode, every 2 s) and works from what it sees.
//
// Margin of error (the user, 2026-11-22: a judge can lag behind, or cross a wrong number by mistake):
//   * A heat counts as reached only when enough DIFFERENT judges have crossed somebody in it: the quorum, a third of
//     the round's judges, at least 2 (9 judges -> 3, 7 -> 3, 5 -> 2, 3 -> 2). One judge's wrong number never moves
//     the position; a judge still finishing the previous heat doesn't hold it back.
//   * The position only moves forward on its own. Noise can't pull it back to an earlier heat.
//   * The operator always has the last word: Next heat / Back set the position by hand. The app keeps it until the
//     evidence moves past what it was at that moment (so a Back is not undone by the marks it was correcting).
//   * Evidence, all "at least here":
//       - the dances DanS marks finished: at least heat 1 of the first unfinished dance;
//       - judges who have submitted a dance (DanceCompletion marks): a quorum of them = the dance is over;
//       - the judges' tablets: when a quorum of judges' tablets is on a dance, at least heat 1 of it (round_dance in
//         /competitions – unverified how early it moves; recorded in the heat log to check);
//       - the marks: the latest heat (in dance order) crossed by a quorum of judges.
//
// Positions are { d, h }: d = index into the round's dances (suppressed dances left out), h = index into that dance's
// heats (0 = first heat). Pure functions and a small class with no I/O, so it can be tested from plain Node.

// How many different judges must have crossed somebody in a heat before it counts as being danced.
function quorumFor(judgeCount) {
  if (judgeCount <= 1) return 1;
  return Math.max(2, Math.ceil(judgeCount / 3));
}

// The round as heats: dances in dance order, each with its heats and who dances in them.
//   rawRound: the round from /competitions; draw: /rounds/{r}/draw/competitors; danceName(danceId) -> { abbr, … }
// competitors[].dances[i] follows the round's dance order over ALL its dances (also suppressed ones), so the index
// is taken before suppressed dances are dropped.
function heatPlan(rawRound, draw, danceName = () => ({})) {
  const all = (rawRound?.dances || []).slice().sort((a, b) => a.dance_order - b.dance_order);
  const dances = [];
  all.forEach((rd, drawIndex) => {
    if (rd.state === 'Suppressed') return;
    const heats = new Map();
    for (const c of draw?.competitors || []) {
      const slot = c.dances?.[drawIndex];
      if (!slot || slot.heat == null) continue;
      if (!heats.has(slot.heat)) heats.set(slot.heat, []);
      heats.get(slot.heat).push({ id: c.id, number: c.number ?? null });
    }
    const list = [...heats.entries()].sort((a, b) => a[0] - b[0])
      .map(([heat, comps]) => ({ heat, competitors: comps.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)) }));
    // a dance without a draw yet still has its heats counted, so Next heat can step through them
    if (!list.length) for (let i = 1; i <= Math.max(1, rd.heat_count || 1); i++) list.push({ heat: i, competitors: [] });
    dances.push({ id: rd.id, ...danceName(rd.dance), completed: !!rd.completed_at, heats: list });
  });
  return { roundId: rawRound?.id || null, dances };
}

// Compare positions: negative when a is earlier than b. null counts as before everything.
function cmp(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.d - b.d || a.h - b.h;
}
const later = (a, b) => (cmp(a, b) >= 0 ? a : b);

// One step forward / back through the round; stays put at either end.
function step(plan, pos, dir) {
  const D = plan.dances;
  if (!D.length) return null;
  let { d, h } = pos || { d: 0, h: dir > 0 ? -1 : 0 };
  h += dir;
  if (h >= D[d].heats.length) { if (d + 1 >= D.length) return { d, h: D[d].heats.length - 1 }; d += 1; h = 0; }
  if (h < 0) { if (d === 0) return { d: 0, h: 0 }; d -= 1; h = D[d].heats.length - 1; }
  return { d, h };
}
// The heat after pos; null when pos is the last heat of the round.
function nextOf(plan, pos) {
  if (!pos) return plan.dances.length ? { d: 0, h: 0 } : null;
  const n = step(plan, pos, 1);
  return cmp(n, pos) > 0 ? n : null;
}

// A competitor mark that counts: not suppressed, and not a "nothing" value. Seen on the venue DanS (2026-11-22):
// { Cross: true } a cross, { Cross: false } a cross taken back, "Empty" nothing.
function markCounts(m) {
  if (m.suppressed) return false;
  const v = m.value;
  if (v == null || v === false || v === 'Empty') return false;
  if (typeof v === 'object') return Object.values(v).some((x) => x !== false && x != null);
  return true;
}

// Who has crossed whom: for each dance and heat, the set of judges (letters) with at least one mark there.
//   marks: /rounds/{r}/marks; returns counts[d][h] = Set of judge letters
function markedBy(plan, marks) {
  const where = new Map(); // `${roundDanceId}|${competitorId}` -> [d, h]
  plan.dances.forEach((dn, d) => dn.heats.forEach((ht, h) => ht.competitors.forEach((c) => where.set(`${dn.id}|${c.id}`, [d, h]))));
  const counts = plan.dances.map((dn) => dn.heats.map(() => new Set()));
  for (const m of marks || []) {
    const t = m.target?.Competitor;
    if (!t || !markCounts(m)) continue;
    const at = where.get(`${t.round_dance_id}|${t.competitor_id}`);
    if (at) counts[at[0]][at[1]].add(t.judge);
  }
  return counts;
}

// The furthest position the DanS data proves, with the reason, or null when it proves nothing yet.
//   rawRound: the round from /competitions (completed_at per dance, judges' round_dance); marks may be null
//   (no live marks: on-demand or manual mode, or the read failed)
function evidence(plan, rawRound, marks) {
  const D = plan.dances;
  if (!D.length) return { pos: null, reason: '', counts: [], quorum: 0, roundDone: false };
  const judges = rawRound?.judges || [];
  const judgeCount = judges.length || rawRound?.judge_count || 0;
  const quorum = quorumFor(judgeCount);
  let pos = null, reason = '';
  const take = (p, why) => { if (cmp(p, pos) > 0) { pos = p; reason = why; } };

  // dances DanS has marked finished
  const firstOpen = D.findIndex((dn) => !dn.completed);
  const roundDone = firstOpen < 0;
  if (roundDone) take({ d: D.length - 1, h: D[D.length - 1].heats.length - 1 }, 'every dance is finished in DanS');
  else if (firstOpen > 0) take({ d: firstOpen, h: 0 }, `${D[firstOpen - 1].abbr || 'the previous dance'} is finished in DanS`);

  // judges who have submitted a dance: marks with target DanceCompletion { round_dance_id, judge } (one per judge and
  // dance once submitted; 9 judges x 4 dances = 36 on a finished semifinal). A judge can only submit after the last
  // heat of the dance, so a quorum of them means the dance is over: at least heat 1 of the next one.
  const submitted = D.map(() => new Set());
  for (const m of marks || []) {
    const t = m.target?.DanceCompletion;
    if (!t || m.suppressed) continue;
    const d = D.findIndex((dn) => dn.id === t.round_dance_id);
    if (d >= 0) submitted[d].add(t.judge);
  }
  for (let d = D.length - 2; d >= 0; d--) {
    if (submitted[d].size >= quorum) { take({ d: d + 1, h: 0 }, `${submitted[d].size} judges have submitted ${D[d].abbr || 'the previous dance'}`); break; }
  }

  // the judges' tablets: a quorum on a dance (index of the round dance each tablet is on)
  const onDance = D.map(() => 0);
  for (const j of judges) {
    const d = D.findIndex((dn) => dn.id === j.round_dance);
    if (d >= 0) onDance[d] += 1;
  }
  for (let d = D.length - 1; d >= 0; d--) {
    if (onDance[d] >= quorum) { take({ d, h: 0 }, `${onDance[d]} judges' tablets are on ${D[d].abbr || 'this dance'}`); break; }
  }

  // the marks: the latest heat crossed by a quorum of judges
  const counts = marks ? markedBy(plan, marks) : D.map((dn) => dn.heats.map(() => new Set()));
  outer: for (let d = D.length - 1; d >= 0; d--) {
    for (let h = D[d].heats.length - 1; h >= 0; h--) {
      if (counts[d][h].size >= quorum) { take({ d, h }, `${counts[d][h].size} of ${judgeCount} judges have crossed in it`); break outer; }
    }
  }
  return { pos, reason, counts, quorum, judgeCount, roundDone };
}

// Keeps the position of one round between polls: forward-only evidence, plus the operator's Next / Back.
class RoundTracker {
  constructor(roundId) {
    this.roundId = roundId;
    this.auto = true;          // follow the evidence; off = only the operator moves it
    this.evidencePos = null;   // furthest position the data has proved so far (never goes back)
    this.manual = null;        // { pos, evidenceAt } – set by Next / Back
    this.firstSeen = new Map(); // mark key -> time first seen (for "judges marking now")
    this.seeded = false;
  }

  // New data. now = time of the read; marks null when there are no live marks.
  update(plan, rawRound, marks, now = Date.now()) {
    this.plan = plan;
    const ev = evidence(plan, rawRound, marks);
    this.ev = ev;
    this.evidencePos = later(this.evidencePos, ev.pos);
    if (marks) {
      // marks seen for the first time; on the very first read they are old news (time 0)
      const keys = new Set();
      for (const m of marks) {
        const t = m.target?.Competitor;
        if (!t || !markCounts(m)) continue;
        const k = `${t.round_dance_id}|${t.competitor_id}|${t.judge}`;
        keys.add(k);
        if (!this.firstSeen.has(k)) this.firstSeen.set(k, this.seeded ? now : 0);
      }
      for (const k of [...this.firstSeen.keys()]) if (!keys.has(k)) this.firstSeen.delete(k); // crosses taken back
      this.seeded = true;
    }
    this.now = now;
    return this.position();
  }

  // Where the round is now: the operator's position until the evidence moves past what it was when they set it.
  position() {
    if (!this.plan?.dances.length) return null;
    const evPos = this.auto ? this.evidencePos : null;
    if (this.manual) {
      if (!this.auto || cmp(evPos, this.manual.evidenceAt) <= 0) return this.manual.pos;
      return later(evPos, this.manual.pos);
    }
    return evPos || { d: 0, h: 0 };
  }

  // Next heat (+1) / Back (-1) by the operator.
  move(dir) {
    const cur = this.position();
    if (!cur) return null;
    this.manual = { pos: step(this.plan, cur, dir), evidenceAt: this.auto ? this.evidencePos : null };
    return this.position();
  }
  setAuto(on) {
    this.auto = !!on;
    // switching back to automatic: the operator's position stays until new evidence arrives
    if (this.manual) this.manual.evidenceAt = this.auto ? this.evidencePos : null;
  }

  // Judges who crossed somebody in this heat during the last `windowMs` (seen live, not from the first read).
  recentJudges(d, h, windowMs = 20000) {
    const dn = this.plan?.dances[d];
    if (!dn) return [];
    const ids = new Set(dn.heats[h].competitors.map((c) => c.id));
    const out = new Set();
    for (const [k, t] of this.firstSeen) {
      if (!t || this.now - t > windowMs) continue;
      const [rd, comp, judge] = k.split('|');
      if (rd === dn.id && ids.has(comp)) out.add(judge);
    }
    return [...out].sort();
  }

  // What the window shows: every dance and heat with its state, now and next, and why.
  view() {
    const plan = this.plan;
    if (!plan) return null;
    const pos = this.position();
    const next = pos ? nextOf(plan, pos) : null;
    const ev = this.ev || {};
    const heatAt = (p) => p && { d: p.d, h: p.h, dance: plan.dances[p.d].abbr || '', danceName: plan.dances[p.d].name || '',
      heat: plan.dances[p.d].heats[p.h].heat, heatCount: plan.dances[p.d].heats.length,
      numbers: plan.dances[p.d].heats[p.h].competitors.map((c) => c.number) };
    const manualHolds = !!this.manual && pos === this.manual.pos;
    return {
      roundId: this.roundId, auto: this.auto,
      now: heatAt(pos), next: heatAt(next),
      roundDone: !!ev.roundDone && !manualHolds,
      source: manualHolds ? 'operator' : this.evidencePos && this.auto ? 'dans' : 'start',
      reason: ev.reason || '', quorum: ev.quorum || 0, judgeCount: ev.judgeCount || 0,
      dances: plan.dances.map((dn, d) => ({
        abbr: dn.abbr || '', name: dn.name || '', completed: dn.completed,
        heats: dn.heats.map((ht, h) => {
          const p = { d, h };
          return {
            heat: ht.heat, numbers: ht.competitors.map((c) => c.number),
            marked: ev.counts?.[d]?.[h]?.size || 0, // different judges with a cross here
            marking: this.recentJudges(d, h),      // of them, those who crossed in the last 20 s
            state: cmp(p, pos) < 0 ? 'done' : cmp(p, pos) === 0 ? 'now' : next && cmp(p, next) === 0 ? 'next' : '',
          };
        }),
      })),
    };
  }
}

module.exports = { quorumFor, heatPlan, evidence, markedBy, markCounts, step, nextOf, cmp, RoundTracker };
