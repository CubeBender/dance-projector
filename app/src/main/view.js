'use strict';
// Composes what the output pages see: the two display slots with everything already resolved.
const { buildHeats } = require('./model');

// Crop is { x, y } in percent (focus point) and zoom >= 1. Missing crop = centred, upper third.
function cleanCrop(c) {
  if (!c) return { x: 50, y: 30, zoom: 1 };
  const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  return { x: clamp(c.x, 0, 100, 50), y: clamp(c.y, 0, 100, 30), zoom: clamp(c.zoom, 1, 4, 1) };
}

function judgeView(j, store) {
  const extra = store.judge(j.fedId);
  return {
    letter: j.letter,
    name: extra.displayName || `${j.name} ${j.surname}`.trim(),
    firstName: j.name, surname: j.surname,
    country: j.country && j.country !== 'CZE' ? j.country : '',
    photo: extra.photo ? `/photos/${encodeURIComponent(extra.photo)}` : null,
    crop: cleanCrop(extra.crop),
  };
}

function slotView(key, model, raw, store) {
  const s = store.cfg.slots[key];
  const split = !!store.cfg.split;
  // Whole floor: slot A only, no side label, neutral accent. Split floor: side names and lighting colours.
  const base = split
    ? { key, label: s.label, labelEn: s.labelEn, color: s.color, competition: null }
    : { key, label: '', labelEn: '', color: store.cfg.wholeColor, competition: null };
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

function outputState(model, raw, store, status) {
  return {
    updated: Date.now(),
    connected: !!status?.connected,
    event: model?.event ? { name: model.event.name, location: model.event.location, date: model.event.date } : null,
    split: !!store.cfg.split,
    language: store.cfg.language,
    heatsShow: store.cfg.heatsShow,
    slots: model ? { A: slotView('A', model, raw, store), B: slotView('B', model, raw, store) } : {},
  };
}

module.exports = { outputState, judgeView, cleanCrop };
