'use strict';
// Reading a DanS printout (decision D-17, D-24): text recognised from a webcam / phone photo of a printed sheet is
// matched against what the app already knows from the offline copy and the gallery.
//
// The sheet we expect most is DanS's ROUND START LIST ("Startovní listina"), which has everything on one page:
//   Startovní listina    1 · Do 8 let E Solo SoKOMB · Finále           <- competition number · title · round
//   Pardubický podzimní pohár …                                         <- event
//   №  Soutěžící            Klub         Země
//   1  Jana Nováková        Klub A                                       <- start number, name(s)
//   …
//   Porota
//   B — Jakub Novák, H — Eva Malá Veselá, …                              <- judge letter — name
//   Rozlosování skupin …
// Other DanS sheets with the same kind of lines (number + name, letter — name) work the same way.
//
// Text recognition makes mistakes ("Šimačkový" for "Šimáčková", junk from the desk around the paper), so the parser
// does not trust the layout. It starts from the NAMES it knows: every competitor of the event and every judge is
// looked for in each line with a forgiving comparison, and the start number is the number just before a
// competitor's name. Each result carries a score and `sure`; the window shows the unsure ones for checking.
//
// Pure functions only (no files, no Electron), so it can be tested from plain Node.

// "Šimáčková  Adéla" -> "simackova adela": lower case, no diacritics, single spaces, only letters and digits
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Edit distance (insertions, deletions, substitutions) between two short strings.
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// 1 = the same, 0 = nothing in common
const similarity = (a, b) => (!a && !b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length));

// How well `name` (normalised) appears somewhere in `line` (normalised): the best similarity of the name against any
// run of words of about the same length. Returns { score, start } where start = index of the first word matched.
function findIn(name, words) {
  const n = name.split(' ').length;
  let best = { score: 0, start: -1, end: -1 };
  for (let len = Math.max(1, n - 1); len <= n + 1; len++) {
    for (let i = 0; i + len <= words.length; i++) {
      const s = similarity(name, words.slice(i, i + len).join(' '));
      if (s > best.score) best = { score: s, start: i, end: i + len };
    }
  }
  return best;
}

// A person's name in both orders, since printouts may say "Jana Nováková" or "Nováková Jana".
const nameForms = (p) => [norm(`${p.name} ${p.surname}`), norm(`${p.surname} ${p.name}`)].filter((x) => x.includes(' ') || x);

// Lines of recognised text -> [{ raw, words }] with junk-only lines dropped.
function prepareLines(text) {
  return String(text || '').split(/\r?\n/).map((raw) => ({ raw: raw.trim(), words: norm(raw).split(' ').filter(Boolean) }))
    .filter((l) => l.words.length);
}

const SURE = 0.82;    // a match at least this good is taken without asking…
const MARGIN = 0.08;  // …if the next best candidate is clearly worse
const MAYBE = 0.62;   // between MAYBE and SURE: shown, marked for checking; below: ignored

// ---- header: "Startovní listina  1 · Do 8 let E Solo SoKOMB · Finále" ----
const ROUND_WORDS = /\b(finale|semifinale|ctvrtfinale|osmifinale|opravne kolo|\d+\s*kolo)\b/;
// competitions: [{ id, number, title, rounds: [round names] }]
function parseHeader(lines, competitions = []) {
  // the title line is near the top and ends with a round name; "listina" usually precedes it
  for (const l of lines.slice(0, 6)) {
    const t = l.words.join(' ');
    const m = t.match(ROUND_WORDS);
    if (!m) continue;
    // junk the camera saw left of the sheet comes before "listina"; drop it with the word
    const before = t.slice(0, m.index).replace(/^.*?listina\s*/, '').trim();
    if (!before) continue; // a line that is only a round name (e.g. in the heats table) is not the title
    const num = before.match(/^(?:\D{0,4}\s)?(\d{1,3})\s+(.*)$/);
    const number = num ? Number(num[1]) : null;
    const title = (num ? num[2] : before).trim();
    // the competition: same number and a similar title; or, if the number was misread, a clearly similar title
    let comp = null, score = 0;
    for (const c of competitions) {
      const s = similarity(norm(c.title), title) + (c.number === number ? 0.3 : 0);
      if (s > score) { score = s; comp = c; }
    }
    if (comp && !(comp.number === number && score >= 0.8) && score < 0.85) comp = null;
    // round: the competition's own round name that is closest to what was read
    const readRound = m[1].replace(/(\d+)\s*kolo/, '$1 kolo');
    const known = (comp?.rounds || []).map((r) => ({ r, s: similarity(norm(r), readRound) })).sort((a, b) => b.s - a.s)[0];
    const round = known && known.s >= 0.7 ? known.r : prettyRound(readRound);
    return { number, title, round, compId: comp?.id || null, sure: !!comp, line: l.raw };
  }
  return null;
}
const prettyRound = (r) => ({ finale: 'Finále', semifinale: 'Semifinále', ctvrtfinale: 'Čtvrtfinále', osmifinale: 'Osmifinále', 'opravne kolo': 'Opravné kolo' }[r]
  || r.replace(/^(\d+) kolo$/, '$1. kolo'));

// ---- competitor rows: "<number> <name> <club>" ----
// competitors: [{ key, people: [{ name, surname }], label }]
// Each competitor is looked for in every line (and, for couples, the partner in the same or the next line).
// The start number is the last number in the line before the name. Returns the found ones, best first per line.
function parseCompetitors(lines, competitors = []) {
  // the judges' part ("Porota" up to the next heading) holds names too; competitors are never there
  const pStart = lines.findIndex((l) => /^porota\b/.test(l.words.join(' ')));
  const pEnd = pStart < 0 ? -1 : lines.findIndex((l, i) => i > pStart && /^(rozlosovani|celkem|startovni|vysledky)\b/.test(l.words.join(' ')));
  const inJudges = (i) => pStart >= 0 && i >= pStart && (pEnd < 0 || i < pEnd);
  // a continuation line: the second partner of a couple printed under the first, without a number of its own
  const continues = (i) => lines[i] && !/^\d/.test(lines[i].words[0]) && !inJudges(i);
  const found = [];
  for (const c of competitors) {
    const people = (c.people || []).filter((p) => p.name || p.surname);
    if (!people.length) continue;
    let best = null;
    lines.forEach((l, i) => {
      if (inJudges(i)) return;
      // every person of the competitor must be there: in this line, or (a couple printed on two lines) the partner
      // in the next line when that line has no start number of its own – found there it counts a little less
      let total = 0, first = null;
      for (const [k, p] of people.entries()) {
        let pb = { score: 0 };
        for (const li of k === 0 ? [i] : continues(i + 1) ? [i, i + 1] : [i]) {
          for (const form of nameForms(p)) {
            const r = findIn(form, lines[li].words);
            const sc = r.score * (li === i ? 1 : 0.92);
            if (sc > pb.score) pb = { ...r, score: sc, li };
          }
        }
        total += pb.score;
        if (k === 0) first = pb;
      }
      const score = total / people.length;
      if (!best || score > best.score) best = { score, line: i, start: first.start };
    });
    if (!best || best.score < MAYBE) continue;
    // start number: the last number before the name in that line (junk before it is ignored)
    const before = lines[best.line].words.slice(0, best.start);
    const nums = before.filter((w) => /^\d{1,3}$/.test(w));
    const number = nums.length ? String(Number(nums[nums.length - 1])) : null;
    const nr = number === '0' ? null : number;
    if (!nr && best.score < SURE) continue; // a doubtful name with no number in front is most likely not a row
    found.push({ key: c.key, label: c.label, kind: people.length > 1 ? 'couple' : 'solo', number: nr, score: round2(best.score), line: lines[best.line].raw, lineIndex: best.line });
  }
  // one line belongs to one competitor: keep the best per line; the others there are doubtful
  const byLine = new Map();
  for (const f of found.sort((a, b) => b.score - a.score)) {
    const other = byLine.get(f.lineIndex);
    if (!other) { byLine.set(f.lineIndex, f); f.sure = f.score >= SURE; }
    else if (other.score - f.score < MARGIN) other.sure = false; // two names fit one line about equally: ask
  }
  let out = [...byLine.values()];
  // a competition is all solo or all couples: once the sure readings say which, the other kind is dropped
  const kinds = out.filter((f) => f.sure).map((f) => f.kind);
  if (kinds.length) {
    const solo = kinds.filter((k) => k === 'solo').length, main = solo * 2 >= kinds.length ? 'solo' : 'couple';
    out = out.filter((f) => f.kind === main);
  }
  // the same number read for two competitors: both need checking
  const count = new Map(); out.forEach((f) => f.number && count.set(f.number, (count.get(f.number) || 0) + 1));
  for (const f of out) if (!f.number || count.get(f.number) > 1) f.sure = false;
  return out.sort((a, b) => a.lineIndex - b.lineIndex).map(({ lineIndex, kind, ...f }) => f);
}

// ---- judges: "B — Jakub Novák, H — Eva Malá Veselá, …" ----
// judges: [{ fedId, name, surname }]. Reads the part after the "Porota" heading (the whole text if there is none),
// splits it at "<letter> —", and matches each name. A judge found elsewhere in that part without a readable letter
// is still listed (letter '').
function parseJudges(lines, judges = []) {
  let from = lines.findIndex((l) => /^porota\b/.test(l.words.join(' ')));
  let to = lines.length;
  if (from >= 0) {
    const stop = lines.findIndex((l, i) => i > from && /^(rozlosovani|celkem|startovni|vysledky)\b/.test(l.words.join(' ')));
    if (stop > 0) to = stop;
    from += 1;
  } else from = 0;
  const part = lines.slice(from, to).map((l) => l.raw).join(', ');
  // "B — Jakub Novák" pieces: a 1–2 character letter, a dash of any kind, then the name up to the next comma
  const pieces = [...part.matchAll(/(?:^|[,;.])\s*([A-ZÁ-Ž0-9]{1,2})\s*[—–\-~=:]+\s*([^,;]+)/g)].map((m) => ({ letter: m[1], words: norm(m[2]).split(' ').filter(Boolean) }));
  const scoreOf = (j, words) => Math.max(...nameForms(j).map((f) => findIn(f, words).score));
  const out = [];
  const used = new Set();
  for (const piece of pieces) {
    const ranked = judges.map((j) => ({ j, s: scoreOf(j, piece.words) })).sort((a, b) => b.s - a.s);
    const [a, b] = ranked;
    if (!a || a.s < MAYBE || used.has(a.j.fedId)) continue;
    used.add(a.j.fedId);
    out.push({ letter: piece.letter.length === 1 && /[A-Z]/.test(piece.letter) ? piece.letter : '', fedId: a.j.fedId, name: `${a.j.name} ${a.j.surname}`.trim(),
      score: round2(a.s), sure: a.s >= SURE && (!b || a.s - b.s >= MARGIN) });
  }
  // judges whose letter + dash were garbled: look for their whole name in the judges' part
  const words = norm(part).split(' ').filter(Boolean);
  for (const j of judges) {
    if (used.has(j.fedId)) continue;
    const s = scoreOf(j, words);
    if (s >= SURE) { used.add(j.fedId); out.push({ letter: '', fedId: j.fedId, name: `${j.name} ${j.surname}`.trim(), score: round2(s), sure: false }); }
  }
  return out;
}

const round2 = (x) => Math.round(x * 100) / 100;

// Everything from one recognised text. known = { competitions, competitors, judges } (see the functions above).
function parsePrintout(text, known = {}) {
  const lines = prepareLines(text);
  const kind = /startovni listina/.test(lines.slice(0, 4).map((l) => l.words.join(' ')).join(' ')) ? 'startlist' : 'other';
  return {
    kind,
    header: parseHeader(lines, known.competitions),
    competitors: parseCompetitors(lines, known.competitors),
    judges: parseJudges(lines, known.judges),
  };
}

// Results of several recognitions of the same sheet (e.g. the prepared and the original image) put together: for
// each competitor / judge the better reading wins; the header with a known competition wins.
function mergeResults(results) {
  const rs = results.filter(Boolean);
  const pick = (list, id) => {
    const m = new Map();
    for (const r of rs) {
      for (const x of r[list]) {
        const o = m.get(x[id]);
        // a sure reading beats an unsure one; then the clearly better match; then the one that has the number / letter
        const better = !o || (x.sure && !o.sure) || (x.sure === o.sure && (x.score > o.score + 0.05
          || (x.score >= o.score - 0.05 && ((x.number && !o.number) || (x.letter && !o.letter)))));
        // sure if any reading was sure and they agree on the number / letter
        const agree = o && (x.number || '') === (o.number || '') && (x.letter || '') === (o.letter || '');
        if (better) m.set(x[id], { ...x, sure: x.sure || !!(agree && o.sure) });
        else if (agree && x.sure) o.sure = true;
      }
    }
    return [...m.values()];
  };
  const header = rs.map((r) => r.header).filter(Boolean).sort((a, b) => b.sure - a.sure)[0] || null;
  const competitors = pick('competitors', 'key').sort((a, b) => (Number(a.number) || 9999) - (Number(b.number) || 9999));
  const judges = pick('judges', 'fedId').sort((a, b) => (a.letter || '~').localeCompare(b.letter || '~'));
  return { kind: rs.some((r) => r.kind === 'startlist') ? 'startlist' : 'other', header, competitors, judges };
}

module.exports = { norm, similarity, findIn, prepareLines, parseHeader, parseCompetitors, parseJudges, parsePrintout, mergeResults, SURE };
