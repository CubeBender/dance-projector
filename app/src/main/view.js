'use strict';
// Composes what the output pages see: the two display slots with everything already resolved,
// the schedule and the event's style. The result goes to projection.js as the draft.
const { buildHeats } = require('./model');
const { themeFor, themeView } = require('./theme');
const { mainPhoto } = require('./gallery');
const { sortJudges } = require('./panels');
const { fromStartlist, mergeCompetitors, findByNumber, screenName, numberKey, dansKey } = require('./competitors');
const { finalRound, placesFromDraw, placeGroups, ladder } = require('./results');

// Crop is { x, y } in percent (focus point) and zoom >= 1. Missing crop = centred, upper third.
function cleanCrop(c) {
  if (!c) return { x: 50, y: 30, zoom: 1 };
  const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  return { x: clamp(c.x, 0, 100, 50), y: clamp(c.y, 0, 100, 30), zoom: clamp(c.zoom, 1, 4, 1) };
}

// A judge as the output pages draw it. j is the DanS judge (letter, names, federation id); the gallery entry
// for the same IDT adds the names the operator keeps, the optional name on screen and the main portrait.
// Gallery names win over DanS, because they are the ones the operator checked.
function judgeView(j, store) {
  const g = store.judge(j.fedId);
  const first = g.name || j.name || '', last = g.surname || j.surname || '';
  const portrait = mainPhoto(g);
  return {
    letter: j.letter,
    name: g.displayName || `${first} ${last}`.trim(),
    firstName: first, surname: last,
    // the two lines of the judge card: small first name, large surname. Without a typed "name on screen" they
    // come straight from the name fields, so a double surname ("Malá Veselá") stays together.
    lines: g.displayName ? null : [first, last],
    country: j.country && j.country !== 'CZE' ? j.country : '',
    photo: portrait ? `/photos/${encodeURIComponent(portrait.file)}` : null,
    crop: cleanCrop(portrait?.crop),
  };
}

// theme: the event's style; its accent colours the slot when the whole floor is one competition.
// Own selection (decision D-19): judges picked from the gallery with letters set by the operator, and an optional
// competition number / title / round typed by hand. Built from the gallery and config only, so it works with no
// DanS connection and no event. Judges deleted from the gallery drop out.
function manualCompetition(key, store) {
  const m = store.cfg.manualPanels?.[key] || {};
  return {
    id: `manual-${key}`, manual: true,
    number: m.number || null, title: m.title || '', titleEn: m.titleEn || '', titleShort: '',
    state: null, running: false,
    round: m.round ? { name: m.round, competes: null, advances: null, currentDance: -1, dances: [] } : null,
    judges: slotJudges(key, null, store).map((x) => x.view),
  };
}

// The judges of one screen side in the order they appear on screen, as [{ fedId, view }].
// view is what the output pages draw (judgeView); fedId (IDT) stays here, it is not sent to the pages.
// Own selection: the gallery judges picked for the side (judges deleted from the gallery drop out).
// From DanS: the panel of the competition shown on the side (hand-edited or as drawn).
// The order is the side's "judgeSort" setting (panels.js sortJudges); used by the output and the window alike.
function slotJudges(key, model, store) {
  const s = store.cfg.slots[key];
  let list;
  if (s.source === 'manual') {
    list = (store.cfg.manualPanels?.[key]?.judges || [])
      .filter((j) => Object.keys(store.judge(j.fedId)).length)
      .map((j) => ({ fedId: j.fedId, letter: j.letter || '' }));
  } else {
    list = model?.competitions.find((c) => c.id === s.competitionId)?.judges || [];
  }
  const items = list.map((j) => ({ fedId: j.fedId, view: judgeView(j, store) }));
  // sort on the names as shown (gallery names win over DanS), keeping the IDT for the custom order
  const sorted = sortJudges(items.map((x) => ({ ...x, letter: x.view.letter, firstName: x.view.firstName, surname: x.view.surname })),
    s.judgeSort || 'surname', s.order || []);
  return sorted.map(({ fedId, view }) => ({ fedId, view }));
}

function slotView(key, model, raw, store, theme) {
  const s = store.cfg.slots[key];
  const split = !!store.cfg.split;
  // Whole floor: slot A only, no side label, neutral accent. Split floor: side names and lighting colours.
  const base = split
    ? { key, label: s.label, labelEn: s.labelEn, color: s.color, competition: null }
    : { key, label: '', labelEn: '', color: theme.accent, competition: null };
  if (!split && key !== 'A') return base;
  if (s.source === 'manual') return { ...base, competition: manualCompetition(key, store) };
  const comp = model?.competitions.find((c) => c.id === s.competitionId) || null;
  if (!comp) return base;
  const heats = comp.round ? buildHeats(model, comp, raw.draws?.[comp.round.id]) : null;
  const cur = comp.round?.currentDance ?? -1;
  return {
    ...base,
    competition: {
      id: comp.id, number: comp.number, title: comp.title, titleEn: comp.titleEn, titleShort: comp.titleShort,
      state: comp.state, running: comp.running,
      round: comp.round && {
        name: comp.round.name, state: comp.round.state, competes: comp.round.competes, advances: comp.round.advances,
        currentDance: cur,
        dances: comp.round.dances.map((d, i) => ({ name: d.name, nameCs: d.nameCs, nameEn: d.nameEn, abbr: d.abbr, completed: d.completed,
          heats: heats?.dances?.[i]?.heats || [] })),
      },
      judges: slotJudges(key, model, store).map((x) => x.view),
    },
  };
}

// Every competition of the event, for the schedule page (ordered by check-in end like the DanS Organizace page).
function scheduleView(model, store) {
  if (!model) return [];
  const onScreen = new Map(Object.entries(store.cfg.slots).filter(([k]) => store.cfg.split || k === 'A').map(([k, s]) => [s.competitionId, k]));
  return model.competitions
    .map((c) => {
      const d = c.round?.dances?.[c.round.currentDance];
      return {
        number: c.number, title: c.title, titleEn: c.titleEn, checkInEnd: c.checkInEnd, state: c.state, running: c.running,
        slot: onScreen.get(c.id) || null,
        round: c.round ? { name: c.round.name, state: c.round.state } : null,
        dance: c.running && d ? { name: d.name, nameCs: d.nameCs, nameEn: d.nameEn } : null,
      };
    })
    .sort((a, b) => (a.checkInEnd || 0) - (b.checkInEnd || 0) || a.number - b.number);
}

function outputState(model, raw, store, status) {
  const theme = themeFor(store.cfg, store.cfg.eventId);
  return {
    theme: themeView(theme),
    schedule: scheduleView(model, store),
    updated: Date.now(),
    connected: !!status?.connected,
    event: model?.event ? { name: model.event.name, location: model.event.location, date: model.event.date } : null,
    split: !!store.cfg.split,
    language: store.cfg.language,
    heatsShow: store.cfg.heatsShow,
    // computed even without DanS data: an own selection needs none
    slots: { A: slotView('A', model, raw, store, theme), B: slotView('B', model, raw, store, theme) },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Competitors (decision D-22)
// ---------------------------------------------------------------------------------------------------------

// Every competitor of the current event: DanS start list merged with what is stored in the app (competitors.js).
// Works without DanS data (only stored entries then).
// A competitor without a photo of its own shows the photo the same dancer(s) have in the other event of a two-day
// competition (found by IDT, C-38) – marked `borrowed`, so the window can say so. A photo added here wins.
function competitorList(raw, store) {
  // start numbers DanS put in round draws, finals read for the results included (D-26)
  return mergeCompetitors(fromStartlist(raw?.startlist, { ...raw?.draws, ...raw?.results }), store.storedCompetitors()).map((c) => {
    if (c.photos.length) return c;
    const other = store.photosFromOtherEvent(c.people.map((p) => p.idt));
    return other ? { ...c, photos: other.photos, main: other.main, borrowed: other.eventKey } : c;
  });
}

// One competitor card as the output page draws it. The page never gets IDTs, only what it shows: since D-27 that
// includes the club and the sponsor (empty when there is none).
function competitorView(c) {
  const portrait = mainPhoto(c);
  const n = screenName(c);
  return {
    number: Number(c.number), kind: c.kind, first: n.first, last: n.last, surnames: n.surnames,
    club: c.club || '', sponsor: c.sponsor || '',
    photo: portrait ? `/photos/${encodeURIComponent(portrait.file)}` : null,
    crop: cleanCrop(portrait?.crop),
  };
}

// Header of the competitor screen: the DanS competition picked (number, titles, the round the numbers came from),
// overridden field by field by what was typed. null when there is nothing to say.
function competitorHeader(model, scr) {
  const comp = model?.competitions.find((c) => c.id === scr.competitionId) || null;
  const h = {
    number: scr.number || comp?.number || null,
    title: scr.title || comp?.title || '',
    titleEn: scr.titleEn || (scr.title ? '' : comp?.titleEn || ''),
    round: scr.round || scr.roundName || '',
  };
  return h.number || h.title || h.titleEn || h.round ? h : null;
}

// What the competitor projection draws (/out/competitors.html on the competitor port).
//   screen.competitors – the round's competitors, sorted by number; a number nobody has yet still gets a card
//   screen.spotlight   – the one competitor of spotlight mode (null when none is picked or it's not in the round)
function competitorState(model, raw, store) {
  const scr = store.cfg.competitorScreen || {};
  const list = competitorList(raw, store);
  // the round is a list of start numbers; each is looked up among the competitors that have that number
  const competitors = (scr.numbers || []).map(numberKey).filter(Boolean)
    .sort((a, b) => a - b)
    .map((n) => competitorView({ ...(findByNumber(list, n) || { kind: 'solo', people: [] }), number: n }));
  const spot = numberKey(scr.spotlight);
  return {
    results: resultsState(model, raw, store, list),
    theme: themeView(themeFor(store.cfg, store.cfg.eventId)),
    language: store.cfg.language,
    event: model?.event ? { name: model.event.name, location: model.event.location, date: model.event.date } : null,
    updated: Date.now(),
    screen: {
      header: competitorHeader(model, scr),
      mode: scr.mode === 'spotlight' ? 'spotlight' : 'round',
      competitors,
      spotlight: (spot && competitors.find((c) => String(c.number) === spot)) || null,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Results announcement (decision D-26)
// ---------------------------------------------------------------------------------------------------------

// What the results page draws (/out/results.html on the competitor port), or null when no results are loaded:
//   header   { number, title, titleEn, round } of the competition
//   scope    'top3' | 'all'
//   rows     the ladder, best place first: [{ label: '1.' | '2.–3.', place, revealed, competitors: [card] }]
//   current  the row revealed last (shown large), null before the first reveal
//   step / total / done   how far the announcement is
// A card is competitorView() plus `place` (the label). Places come from the final's draw kept in raw.results.
// opts.step overrides the revealed count (the window passes Infinity to list every place for the operator).
function resultsState(model, raw, store, list = competitorList(raw, store), opts = {}) {
  const r = store.cfg.results || {};
  const draw = r.roundId ? raw?.results?.[r.roundId] : null;
  if (!r.competitionId || !draw) return null;
  const comp = model?.competitions.find((c) => c.id === r.competitionId) || null;
  const rawComp = (raw?.competitions || []).find((c) => c.id === r.competitionId);
  const final = (rawComp?.rounds || []).find((x) => x.id === r.roundId) || finalRound(rawComp);
  const byKey = new Map(list.map((c) => [c.key, c]));
  const groups = placeGroups(placesFromDraw(draw), r.scope === 'all' ? 'all' : 'top3');
  // a finalist is found by its DanS start-list id (photos, names, club); by number when the start list misses it
  const card = (e, label) => {
    const c = byKey.get(dansKey(e.dansId)) || findByNumber(list, e.number) || { kind: 'solo', people: [] };
    return { ...competitorView({ ...c, number: e.number || c.number }), place: label };
  };
  const l = ladder(groups.map((g) => ({ ...g, entries: g.entries.map((e) => ({ ...e, label: g.label })) })), opts.step ?? r.step, (e) => card(e, e.label));
  return {
    header: comp ? { number: comp.number, title: comp.title, titleEn: comp.titleEn, round: final?.name || '' } : null,
    scope: r.scope === 'all' ? 'all' : 'top3',
    ...l,
  };
}

module.exports = { resultsState, outputState, judgeView, cleanCrop, slotJudges, competitorList, competitorState, competitorView };
