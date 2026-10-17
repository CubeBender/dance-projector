'use strict';
// Turns raw DanS API data into the model used by the control window and the output pages.
// Pure functions, no I/O, so it can be tested from plain Node with a fixture.

// English names for ČSTS lookup abbreviations (DanS only has Czech values for most of them).
const AGE_EN = {
  'U-8': 'Under 8', 'Děti': 'Juvenile', 'Juv-I': 'Juvenile I', 'Juv-II': 'Juvenile II', 'Jun': 'Junior', 'Jun-I': 'Junior I',
  'Jun-II': 'Junior II', 'Y': 'Youth', 'U-21': 'Under 21', 'A': 'Adult', 'Sen': 'Senior', 'Sen-I': 'Senior I',
  'Sen-II': 'Senior II', 'Sen-III': 'Senior III', 'Sen-IV': 'Senior IV', 'Sen-V': 'Senior V', 'Any': '',
};
const CLASS_EN = { 'Open': 'Open', 'En': 'No class', 'Any': '' };
const DISC_EN = {
  '1T': 'Single Dance', 'Any': '', 'STT': 'Standard', 'LAT': 'Latin', '10D': 'Ten Dance', 'KOMB': 'Standard + Latin',
  'SoLAT': 'Solo Latin', 'SoSTT': 'Solo Standard', 'SoKOMB': 'Solo Combination', 'SyLAT': 'Synchro Latin', 'SySTT': 'Synchro Standard',
  'ChLAT': 'Choreo Latin', 'ChSTT': 'Choreo Standard', 'ShowLAT': 'Showdance Latin', 'ShowSTT': 'Showdance Standard',
  'KRB': 'Caribbean', 'Ba': 'Bachata', 'Me': 'Merengue', 'Ss': 'Salsa', 'ShowBa': 'Showdance Bachata', 'ShowMe': 'Showdance Merengue',
  'ShowSs': 'Showdance Salsa', 'Free': 'Free Style',
};
// DanS dance values are English; Czech dancesport names differ for a few.
const DANCE_CS = { 'Viennese Waltz': 'Valčík', 'Chachacha': 'Cha-cha', 'Paso Doble': 'Paso doble' };
const DANCE_EN = { 'Chachacha': 'Cha-cha-cha' };

function indexMap(list) {
  const m = new Map();
  for (const x of list || []) m.set(x.id, { value: x.value, abbr: x.abbreviation || x.value });
  return m;
}

// Collect every {name, surname} object anywhere inside a start-list entry (solo, couple, team).
function collectPeople(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => collectPeople(n, out)); return out; }
  if (typeof node.surname === 'string' && typeof node.name === 'string') out.push(node);
  for (const [k, v] of Object.entries(node)) if (k !== 'in_authority_id') collectPeople(v, out);
  return out;
}

function competitorName(entry) {
  if (entry.name) return entry.name; // team or formation name
  const people = collectPeople(entry.people);
  const seen = new Set();
  return people
    .filter((p) => { const k = p.id || p.name + p.surname; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((p) => `${p.name} ${p.surname}`.trim())
    .join(' & ');
}

const { pickRoundId } = require('./roundpick');
function pickRound(comp) {
  const id = pickRoundId(comp);
  return (comp.rounds || []).find((r) => r.id === id) || null;
}

function buildModel(raw, opts = {}) {
  const runningStates = opts.runningStates || ['InProgress'];
  const ix = {
    age: indexMap(raw.indexes?.age), class: indexMap(raw.indexes?.class),
    discipline: indexMap(raw.indexes?.discipline), dance: indexMap(raw.indexes?.dance),
    role: indexMap(raw.indexes?.official_role),
  };
  const judgeRoleIds = new Set([...ix.role].filter(([, v]) => /^judge$/i.test(v.abbr) || /^judge$/i.test(v.value)).map(([id]) => id));

  const competitors = new Map();
  for (const s of raw.startlist || []) {
    competitors.set(s.id, { id: s.id, number: s.number, name: competitorName(s), club: s.club || '' });
  }

  const judges = new Map();
  for (const j of raw.judges || []) {
    const pd = j.person_display || {};
    judges.set(j.person_id, {
      personId: j.person_id,
      fedId: pd.in_authority_id?.id || null,
      letter: j.label || '',
      name: pd.name || '',
      surname: pd.surname || '',
      country: j.country || '',
    });
  }

  const allocByComp = new Map();
  for (const a of raw.allocation || []) {
    if (judgeRoleIds.size && !judgeRoleIds.has(a.role)) continue;
    if (!allocByComp.has(a.competition)) allocByComp.set(a.competition, []);
    allocByComp.get(a.competition).push(a.person);
  }

  const competitions = (raw.competitions || []).map((c) => {
    const age = ix.age.get(c.age), cls = ix.class.get(c.class), disc = ix.discipline.get(c.discipline);
    const title = c.name || [age?.value, cls?.value, disc?.value].filter(Boolean).join(' ');
    const titleShort = [age?.value, cls?.abbr, disc?.abbr].filter(Boolean).join(' ');
    const en = (map, v) => (v ? (v.abbr in map ? map[v.abbr] : v.value) : '');
    const titleEn = c.name || [en(AGE_EN, age), cls ? (cls.abbr in CLASS_EN ? CLASS_EN[cls.abbr] : cls.value) : '', en(DISC_EN, disc)].filter(Boolean).join(' ');
    const r = pickRound(c);
    let round = null;
    if (r) {
      const dances = (r.dances || [])
        .filter((d) => d.state !== 'Suppressed')
        .sort((a, b) => a.dance_order - b.dance_order)
        .map((d) => {
          const v = ix.dance.get(d.dance)?.value || '?';
          return {
            id: d.id, order: d.dance_order,
            name: v, nameCs: DANCE_CS[v] || v, nameEn: DANCE_EN[v] || v, abbr: ix.dance.get(d.dance)?.abbr || '?',
            heatCount: d.heat_count, completed: !!d.completed_at,
          };
        });
      let current = dances.findIndex((d) => !d.completed);
      if (current < 0) current = dances.length - 1;
      round = {
        id: r.id, name: r.name, abbr: r.abbreviation, state: r.state,
        competes: r.competes, advances: r.advances, started: r.started,
        dances, currentDance: current,
        judgePersons: (r.judges || []).map((j) => j.person),
      };
    }
    const judgePersons = round?.judgePersons?.length ? round.judgePersons : (allocByComp.get(c.id) || []);
    const judgeList = judgePersons.map((p) => judges.get(p)).filter(Boolean)
      .sort((a, b) => a.letter.localeCompare(b.letter, 'cs'));
    return {
      id: c.id, number: c.competition_number, title, titleEn, titleShort,
      state: c.state, checkInEnd: c.check_in_end || c.planned_check_in_end || null,
      registered: c.registered_count, checkedIn: c.checked_in_count,
      running: !!(round && runningStates.includes(round.state)),
      round, judges: judgeList,
    };
  }).sort((a, b) => a.number - b.number);

  return { event: raw.event || null, competitions, competitors, judges };
}

// Heats for every dance of a round, from /rounds/{r}/draw/competitors.
function buildHeats(model, comp, draw) {
  if (!comp?.round || !draw) return null;
  const dances = comp.round.dances.map((d, i) => {
    const heats = new Map();
    for (const c of draw.competitors || []) {
      const slot = c.dances?.[i];
      if (!slot || slot.heat == null) continue;
      const info = model.competitors.get(c.id) || { number: c.number, name: '', club: '' };
      if (!heats.has(slot.heat)) heats.set(slot.heat, []);
      heats.get(slot.heat).push({ number: c.number ?? info.number, name: info.name, club: info.club });
    }
    return {
      ...d,
      heats: [...heats.entries()].sort((a, b) => a[0] - b[0])
        .map(([heat, list]) => ({ heat, competitors: list.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)) })),
    };
  });
  return { roundId: comp.round.id, dances };
}

module.exports = { buildModel, buildHeats, competitorName };
