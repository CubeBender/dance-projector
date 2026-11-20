'use strict';
// Judge panels chosen by the operator (decision D-13).
//
// DanS draws the judges for each competition shortly before it starts. The operator can either use that
// allocation as read from DanS, or pick the panel by hand (manual mode, or to correct a panel before pushing).
// A hand-picked panel is an "override": a list of DanS person ids stored per event and competition in
// panels.json. While an override exists it wins over the DanS data; "Use DanS panel" deletes it again.
//
// Everything here is pure (no files, no Electron) so it can be tested from plain Node.

// Sort like DanS does: by judge letter.
const byLetter = (a, b) => a.letter.localeCompare(b.letter, 'cs');

// Replaces each competition's judges with the operator's override where one exists, and records where
// the panel came from:
//   panelSource 'manual' – picked by the operator
//   panelSource 'dans'   – allocation read from DanS
//   panelSource 'none'   – no panel yet
// dansJudges keeps the DanS list so the window can show both and offer "Use DanS panel".
// The model is changed in place and also returned.
function applyPanels(model, overrides = {}) {
  if (!model) return model;
  for (const c of model.competitions) {
    c.dansJudges = c.judges;
    const ids = overrides[c.id];
    if (Array.isArray(ids)) {
      c.judges = ids.map((id) => model.judges.get(id)).filter(Boolean).sort(byLetter);
      c.panelSource = 'manual';
    } else {
      c.panelSource = c.judges.length ? 'dans' : 'none';
    }
  }
  return model;
}

// Adds or removes one judge. The first edit of a DanS panel starts from the DanS list, so clicking one judge
// away doesn't throw away the other six.
function togglePanel(current, dansIds, personId) {
  const base = Array.isArray(current) ? current : dansIds.slice();
  return base.includes(personId) ? base.filter((id) => id !== personId) : [...base, personId];
}

// ---- own selections (D-19): judges from the gallery, no DanS ----
// A selection is a list of { fedId, letter }. Letters are what the audience sees on the judges' marks.

// "a " -> "A"; at most 3 characters, letters and digits only.
const cleanLetter = (l) => String(l || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);

// First of A, B, C … Z (then AA, AB …) that nobody in the list has yet.
function nextLetter(list) {
  const used = new Set(list.map((j) => j.letter));
  for (let i = 0; ; i++) {
    const l = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    if (!used.has(l)) return l;
  }
}

// Adds the judge with the next free letter, or removes them if already selected. Returns a new list.
function toggleManual(list = [], fedId) {
  return list.some((j) => j.fedId === fedId) ? list.filter((j) => j.fedId !== fedId) : [...list, { fedId, letter: nextLetter(list) }];
}

// ---- order of the judges on screen ----
// The judge cards no longer show letters, so the order is the operator's choice, per screen side:
//   'surname'   – by surname, then first name (Czech alphabet: Č after C, CH after H, Ř after R …)
//   'firstname' – by first name, then surname
//   'letter'    – by judge letter, which is the DanS order
//   'custom'    – the order the operator arranged with ↑ / ↓ (a list of IDTs)
const SORTS = ['surname', 'firstname', 'letter', 'custom'];
const collator = new Intl.Collator('cs', { sensitivity: 'base', numeric: true });

// list: items with { fedId, letter, firstName, surname } (more fields are kept as they are).
// order: IDTs in the custom order. Judges missing from it (newly added to the panel) go to the end,
// by surname, so adding a judge never shuffles the ones already arranged.
// Returns a new array; the input is not changed.
function sortJudges(list, mode = 'surname', order = []) {
  const bySurname = (a, b) => collator.compare(a.surname || '', b.surname || '') || collator.compare(a.firstName || '', b.firstName || '');
  const cmp = {
    surname: bySurname,
    firstname: (a, b) => collator.compare(a.firstName || '', b.firstName || '') || collator.compare(a.surname || '', b.surname || ''),
    letter: (a, b) => collator.compare(a.letter || '', b.letter || '') || bySurname(a, b),
    custom: (a, b) => {
      const ia = order.indexOf(a.fedId), ib = order.indexOf(b.fedId);
      // -1 (not in the list) counts as "after everything"
      return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || bySurname(a, b);
    },
  }[SORTS.includes(mode) ? mode : 'surname'];
  // Infinity - Infinity is NaN; treat it as "equal" so the surname tie-break decides
  return list.slice().sort((a, b) => cmp(a, b) || 0);
}

// Moves one judge up (delta -1) or down (+1) in an already ordered list of IDTs. Returns a new list.
function moveInOrder(ids, fedId, delta) {
  const i = ids.indexOf(fedId), j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return ids.slice();
  const out = ids.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

module.exports = { applyPanels, togglePanel, cleanLetter, nextLetter, toggleManual, SORTS, sortJudges, moveInOrder };
