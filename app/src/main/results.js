'use strict';
// Announcing the results of a finished competition (decision D-26). Pure functions only (no files, no Electron, no
// network), so they can be tested from plain Node.
//
// Where the places come from: the draw of the FINAL round, GET /rounds/{final}/draw/competitors (the same read-only
// request as "Load from DanS round"). Once the final is finished, each competitor there carries
//   ranking     its final place (1 = winner)
//   ranking_to  the last place of a shared place, when competitors are tied: ranking 2 + ranking_to 3 = "2.–3.";
//               null when the place is not shared
// Verified on the venue DanS, MČR 2026-11-21 competition 1: six finalists with rankings 1–6, ranking_to null.
//
// The announcement goes from the last place to the first. Tied competitors share a place and are revealed
// together, in one step. Each step reveals one PLACE GROUP:
//   groups (best first):     [1.] [2.–3. two competitors] [4.] …
//   reveal order (worst first): … 4., then 2.–3., then 1.
// "Top 3" keeps the groups whose place is 3 or better – with a tie at 3rd, every competitor sharing it.

// The final round of a competition as DanS sends it (competition from /competitions): the latest round judged as a
// final (SkatingFinal, or abbreviated F) that was not cancelled. A redanced final appears as a second F round with
// the first one cancelled. null when the competition has no final (yet).
function finalRound(rawComp) {
  const rounds = (rawComp?.rounds || []).filter((r) => !r.cancelled && r.state !== 'Cancelled'
    && (r.judging === 'SkatingFinal' || r.abbreviation === 'F'));
  rounds.sort((a, b) => (a.logical_order - b.logical_order) || (a.physical_order - b.physical_order));
  return rounds[rounds.length - 1] || null;
}

// Competition states after which the places are final (DanS: Finished on the MČR; Completed / Closed exist too).
const DONE_STATES = new Set(['Finished', 'Completed', 'Closed']);

// Can the results of this competition be announced? Only once the final is finished: before that DanS has no
// places, or only partial ones. Returns { ok, final, reason } – reason says why not, for the window.
function resultsReady(rawComp) {
  const final = finalRound(rawComp);
  if (!final) return { ok: false, final: null, reason: 'No final in DanS' };
  if (final.state === 'Finished' || final.finished || DONE_STATES.has(rawComp.state)) return { ok: true, final, reason: '' };
  return { ok: false, final, reason: 'The final is not finished yet' };
}

// "1." or "2.–3." (Czech style, which the English screen reads fine too)
function placeLabel(place, placeTo) {
  return placeTo && placeTo !== place ? `${place}.–${placeTo}.` : `${place}.`;
}

// Draw of the final -> [{ dansId, number, place, placeTo }] best first. Competitors without a place (not ranked:
// retired, disqualified, or the final not finished) are left out.
function placesFromDraw(draw) {
  return (draw?.competitors || [])
    .filter((c) => Number.isFinite(Number(c.ranking)) && c.ranking != null && Number(c.ranking) >= 1)
    .map((c) => {
      const place = Number(c.ranking);
      const to = Number(c.ranking_to);
      return { dansId: c.id, number: c.number != null ? String(c.number) : null, place, placeTo: Number.isFinite(to) && to > place ? to : null };
    })
    .sort((a, b) => a.place - b.place || Number(a.number) - Number(b.number));
}

// Places -> place groups, best first: [{ place, placeTo, label, entries: [...] }]. Tied competitors (same place) form
// one group. scope 'top3' keeps the groups that start at place 3 or better; 'all' keeps the whole final.
function placeGroups(places, scope = 'top3') {
  const groups = [];
  for (const p of places) {
    const last = groups[groups.length - 1];
    if (last && last.place === p.place) { last.entries.push(p); last.placeTo = Math.max(last.placeTo || last.place, p.placeTo || p.place); continue; }
    groups.push({ place: p.place, placeTo: p.placeTo, entries: [p] });
  }
  // two competitors on the same place without ranking_to still read as a shared place: "2.–3."
  for (const g of groups) {
    if (g.entries.length > 1 && !(g.placeTo > g.place)) g.placeTo = g.place + g.entries.length - 1;
    if (g.placeTo === g.place) g.placeTo = null;
    g.label = placeLabel(g.place, g.placeTo);
  }
  return scope === 'all' ? groups : groups.filter((g) => g.place <= 3);
}

// How many groups are revealed, kept between 0 (nothing yet) and the number of groups (everyone).
const clampStep = (step, n) => Math.max(0, Math.min(n, Math.floor(Number(step) || 0)));

// The ladder as the screen draws it, best place at the top. Groups are revealed from the bottom: with step k the
// k worst groups are shown. `current` is the group revealed last (the one shown large); null before the first step.
//   groups: placeGroups(); describe(entry) -> what the page draws for one competitor
function ladder(groups, step, describe = (e) => e) {
  const n = groups.length;
  const k = clampStep(step, n);
  const rows = groups.map((g, i) => ({
    label: g.label, place: g.place,
    size: g.entries.length,                     // competitors sharing the place (the page makes the row taller)
    revealed: i >= n - k,                       // the last k groups (worst places) are out
    competitors: i >= n - k ? g.entries.map(describe) : [],
  }));
  const current = k ? rows[n - k] : null;
  return { rows, step: k, total: n, current, done: n > 0 && k === n };
}

module.exports = { finalRound, resultsReady, placeLabel, placesFromDraw, placeGroups, ladder, clampStep, DONE_STATES };
