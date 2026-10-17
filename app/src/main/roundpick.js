'use strict';
// Which round of a competition is the "current" one: the latest round that is not cancelled.
function pickRoundId(comp) {
  const rounds = (comp.rounds || []).filter((r) => !r.cancelled && r.state !== 'Cancelled');
  rounds.sort((a, b) => (a.logical_order - b.logical_order) || (a.physical_order - b.physical_order));
  return rounds.length ? rounds[rounds.length - 1].id : null;
}
module.exports = { pickRoundId };
