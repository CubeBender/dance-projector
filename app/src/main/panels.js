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

module.exports = { applyPanels, togglePanel };
