'use strict';
// Composes what the output pages see: the two display slots with everything already resolved,
// the schedule and the event's style. The result goes to projection.js as the draft.
const { buildHeats } = require('./model');
const { themeFor, themeView } = require('./theme');
const { mainPhoto } = require('./gallery');

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
    country: j.country && j.country !== 'CZE' ? j.country : '',
    photo: portrait ? `/photos/${encodeURIComponent(portrait.file)}` : null,
    crop: cleanCrop(portrait?.crop),
  };
}

// theme: the event's style; its accent colours the slot when the whole floor is one competition.
function slotView(key, model, raw, store, theme) {
  const s = store.cfg.slots[key];
  const split = !!store.cfg.split;
  // Whole floor: slot A only, no side label, neutral accent. Split floor: side names and lighting colours.
  const base = split
    ? { key, label: s.label, labelEn: s.labelEn, color: s.color, competition: null }
    : { key, label: '', labelEn: '', color: theme.accent, competition: null };
  if (!split && key !== 'A') return base;
  const comp = model.competitions.find((c) => c.id === s.competitionId) || null;
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
      judges: comp.judges.map((j) => judgeView(j, store)),
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
    slots: model ? { A: slotView('A', model, raw, store, theme), B: slotView('B', model, raw, store, theme) } : {},
  };
}

module.exports = { outputState, judgeView, cleanCrop };
