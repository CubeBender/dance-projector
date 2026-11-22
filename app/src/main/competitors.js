'use strict';
// Competitors of an event (decision D-22): who has which start number, their names and IDTs, and how they appear
// on the competitor projection. Pure functions only (no files, no Electron, no network), so they can be tested
// from plain Node.
//
// Who a competitor is (decision C-37, 2026-11-20): competitors are registered in DanS long before competition
// staff give them start numbers, and the operator prepares names and photos in that time. So a competitor is
// identified by a KEY, not by the number:
//   'dans:<id>'  a competitor of the DanS start list (id of the start-list entry, stable within the event)
//   'm:<id>'     a competitor DanS doesn't know: typed in the app, or created by a photo for an unknown number
// The START NUMBER is shown only when there is one (D-23): for DanS competitors it comes only from DanS (start list,
// or the round draw); the app never makes one up. Typed competitors carry the number that was typed.
// The organizer still refers to competitors by number ("photo of 112"); numberKey() + byNumber lookups do that.
//
// Two sources are merged:
//   DanS start list – number (when given), solo person or couple, IDTs, club, sponsor (read-only)
//   stored entries  – competitors.json: anything typed in the app (names, kind, club, sponsor), photos, typed competitors
// Typed values win over DanS, like judge names in the gallery.
//
// Stored entry (competitors.json → { "<event key>": { "<key>": entry } }):
//   {
//     number,                                  only for 'm:' entries (typed, or the number a phone photo was sent for)
//     printNumber,                             'dans:' entries: the number read from a DanS printout (D-24). On the day the
//                                              offline copy has no numbers, the printed sheet has; it wins while set
//     kind: 'solo' | 'couple',                 only when set in the app
//     people: [{ name, surname, idt }],        only when edited in the app (replaces the DanS people as a whole)
//     club, sponsor,                           optional; typed in the app, win over DanS while not empty (D-27)
//     photos: [{ file, hash, crop }], main,    same shape as the judge gallery (gallery.js)
//     origin: 'manual' | 'phone',              how an 'm:' entry came to exist
//   }
// Entries saved before C-37 were keyed by plain number; store.js turns them into 'm:' entries on load, and
// attachToDans() below moves them onto the DanS competitor once DanS has that number.

// "  012 " -> "12"; anything that is not a start number 1–9999 -> null
function numberKey(n) {
  const s = String(n ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const v = Number(s);
  return v >= 1 ? String(v) : null;
}

// The numbers typed for a round: "12, 45 67;101" -> ['12', '45', '67', '101'] (duplicates and junk dropped).
// Returns { numbers, invalid } so the window can point out what it ignored.
function parseNumbers(text) {
  const numbers = [], invalid = [];
  for (const part of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const k = numberKey(part);
    if (!k) invalid.push(part);
    else if (!numbers.includes(k)) numbers.push(k);
  }
  return { numbers, invalid };
}

const byNumber = (a, b) => Number(a) - Number(b);

// One person from DanS ({ name, surname, in_authority_id: { id } }) -> { name, surname, idt }
const person = (p) => ({ name: String(p?.name || '').trim(), surname: String(p?.surname || '').trim(), idt: p?.in_authority_id?.id ? String(p.in_authority_id.id) : '' });

// DanS start-list entry -> { kind, people } or null for anything we can't show (a team without people).
//   solo:   people.Persons = [person]
//   couple: people.Couples = [{ partner1, partner2 }]
function dansPeople(entry) {
  const pp = entry?.people || {};
  if (Array.isArray(pp.Couples) && pp.Couples[0]) {
    const c = pp.Couples[0];
    return { kind: 'couple', people: [person(c.partner1), person(c.partner2)] };
  }
  if (Array.isArray(pp.Persons) && pp.Persons.length) {
    return { kind: pp.Persons.length === 2 ? 'couple' : 'solo', people: pp.Persons.slice(0, 2).map(person) };
  }
  return null;
}

const dansKey = (id) => `dans:${id}`;

// Competitors DanS knows: Map('dans:<id>' -> { key, dansId, number, kind, people, club, sponsor }).
// sponsor is set for a few competitors only (7 of 283 at the MČR); empty otherwise.
// number is null until DanS has one: it is on the start-list entry once staff give numbers, and a round's draw
// carries DanS's number too (draws = { roundId: { competitors: [{ id, number }] } }). Nothing else makes a number.
function fromStartlist(startlist = [], draws = {}) {
  const numberById = new Map();
  for (const d of Object.values(draws || {})) for (const c of d?.competitors || []) if (c.number != null) numberById.set(c.id, c.number);
  const out = new Map();
  for (const s of startlist || []) {
    const who = dansPeople(s);
    if (!s?.id || !who) continue;
    out.set(dansKey(s.id), { key: dansKey(s.id), dansId: s.id, number: numberKey(s.number ?? numberById.get(s.id)), ...who, club: String(s.club || '').trim(), sponsor: String(s.sponsor || '').trim() });
  }
  return out;
}

// The numbers of a round's draw, sorted: { competitors: [{ number }] } -> ['3', '12', …]
function drawNumbers(draw) {
  return [...new Set((draw?.competitors || []).map((c) => numberKey(c.number)).filter(Boolean))].sort(byNumber);
}

// Every competitor of the event as the window lists them:
//   { key, number (or null), kind, people, club, sponsor, photos, main, inDans, stored, origin, dansPeople, dansClub,
//     dansSponsor, sameNumber }
// Order: by number; competitors without a number after them, by surname.
// dans = fromStartlist(); stored = the event's object from competitors.json.
// A 'dans:' entry whose competitor is not in the start list we have (removed in DanS, or no start list read yet)
// is still listed, so its photos are not lost from view; it has no number then.
function mergeCompetitors(dans, stored = {}) {
  const keys = new Set([...dans.keys(), ...Object.keys(stored)]);
  const list = [...keys].map((key) => {
    const d = dans.get(key) || null, s = stored[key] || {};
    const kind = s.kind || d?.kind || 'solo';
    let people = s.people?.length ? s.people : d?.people || [];
    // always as many people as the kind needs, so the window has a field for each
    people = Array.from({ length: kind === 'couple' ? 2 : 1 }, (_, i) => ({ name: '', surname: '', idt: '', ...people[i] }));
    return {
      key, kind, people,
      number: d ? numberKey(s.printNumber) || d.number : key.startsWith('m:') ? numberKey(s.number) : null,
      // where the number comes from: 'dans' (start list / draw), 'print' (read from a printout), 'typed'
      numberFrom: d ? (numberKey(s.printNumber) ? 'print' : d.number ? 'dans' : null) : numberKey(s.number) ? 'typed' : null,
      // typed club / sponsor win; an empty field falls back to DanS (the window shows the DanS value as a hint)
      club: s.club || d?.club || '', sponsor: s.sponsor || d?.sponsor || '',
      dansClub: d?.club || '', dansSponsor: d?.sponsor || '',
      photos: s.photos || [], main: s.main || null,
      inDans: !!d, stored: !!stored[key], origin: d ? 'dans' : key.startsWith('dans:') ? 'gone' : s.origin || 'manual',
      dansPeople: d?.people || null, // shown as hints when the typed names differ
    };
  });
  const surname = (c) => c.people[0]?.surname || c.people[0]?.name || '';
  list.sort((a, b) => (a.number == null) - (b.number == null) || (a.number != null && a.number - b.number)
    || surname(a).localeCompare(surname(b), 'cs'));
  // two competitors with the same number (a typed one and a DanS one): the window points it out
  const count = new Map();
  for (const c of list) if (c.number) count.set(c.number, (count.get(c.number) || 0) + 1);
  for (const c of list) c.sameNumber = !!c.number && count.get(c.number) > 1;
  return list;
}

// The competitor that has a start number (DanS ones first, they are the real numbers). null when nobody has it.
function findByNumber(list, number) {
  const n = numberKey(number);
  if (!n) return null;
  return list.find((c) => c.number === n && c.inDans) || list.find((c) => c.number === n) || null;
}

// Typed entries ('m:') that only exist because of a number – a photo sent from the phone or pasted for a number
// DanS didn't have yet – belong to the DanS competitor once DanS gives that number. Returns the moves to make:
// [{ from: 'm:…', to: 'dans:…' }]. Entries with typed names stay separate (they are a real typed competitor; the
// window points out the shared number), and so do entries whose DanS competitor already has data stored.
function attachToDans(dans, stored = {}) {
  const moves = [];
  const byNumber = new Map();
  for (const d of dans.values()) if (d.number) byNumber.set(d.number, d);
  for (const [key, s] of Object.entries(stored)) {
    if (!key.startsWith('m:')) continue;
    const d = byNumber.get(numberKey(s.number));
    const typedNames = (s.people || []).some((p) => p.name || p.surname);
    if (d && !typedNames && !stored[d.key]) moves.push({ from: key, to: d.key });
  }
  return moves;
}

// The name lines of a competitor card.
//   solo:   small first name, large surname ("Jana" / "Nováková")
//   couple: only the surnames ("Novák – Dvořáková"), as the user asked (D-22)
// A missing surname falls back to whatever name there is, so a card never ends up blank.
function screenName(c) {
  const p = c.people || [];
  if (c.kind === 'couple') {
    const s = p.map((x) => x.surname || x.name).filter(Boolean);
    return { first: '', last: s.join(' – '), surnames: s };
  }
  const one = p[0] || {};
  return { first: one.surname ? one.name : '', last: one.surname || one.name || '', surnames: [one.surname || one.name || ''].filter(Boolean) };
}

// ---- ČSTS (csts.cz) answers ----
// /api/members/{idt}: { idt, name, surname, clubName, … } (sometimes wrapped as { entity } or { collection: [] })
// /api/1/athletes/{idt}: { collection: [{ name: "Surname Name", … }] } – one string; the site prints it as
// "surname name", so the first word is taken as the surname and the operator can correct it.
function unwrap(json) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json.collection)) return json.collection[0] || null;
  return json.entity || json;
}
function parseCstsMember(json) {
  const m = unwrap(json);
  if (!m || (!m.name && !m.surname)) return null;
  return { name: String(m.name || '').trim(), surname: String(m.surname || '').trim(), club: String(m.clubName || '').trim(), idt: m.idt != null ? String(m.idt) : '' };
}
function parseCstsAthlete(json) {
  const a = unwrap(json);
  const words = String(a?.name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return { surname: words[0], name: words.slice(1).join(' '), club: '', idt: a.idt != null ? String(a.idt) : '', guessed: true };
}

module.exports = { numberKey, parseNumbers, dansPeople, fromStartlist, drawNumbers, mergeCompetitors, findByNumber, attachToDans, screenName, parseCstsMember, parseCstsAthlete, byNumber, dansKey };
