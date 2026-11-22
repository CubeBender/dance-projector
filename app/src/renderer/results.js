'use strict';
// Results tab (decision D-26). Loaded after app.js and competitors.js and uses their helpers ($, $$, h, S, apply,
// applyOr, toast, cropImg): classic scripts share their top-level names.
//
// The operator:
//   1. picks a finished competition and presses Load results (reads the final's places from DanS, 2 requests),
//   2. chooses Top 3 or the whole final,
//   3. reveals the places from the last to the first. Every Reveal / Back / Hide all goes on screen at once (only
//      the results part of the competitor projection is pushed, main.js setupResultsIpc).
// The list below shows every place with names, also the ones not revealed yet, so the operator can read ahead.
// A presentation clicker works too: Page Down / → reveals the next place, Page Up / ← takes it back.

// The competitions offered: those with a final first; the label says when the places are not available yet.
function resultsPicker(R) {
  const withFinal = R.competitions.filter((c) => c.finalId);
  const pick = h('select', { class: 'comp-pick', title: 'Competition whose results are announced' },
    h('option', { value: '' }, withFinal.length ? '– choose a competition –' : S.competitions.length ? 'no competition has a final yet' : 'no DanS data'),
    withFinal.map((c) => h('option', { value: c.id, selected: c.id === R.competitionId },
      `${c.number} · ${c.title}${c.ready ? (c.loaded ? ' · results read' : '') : ` · ${c.reason.toLowerCase()}`}`)));
  pick.addEventListener('change', () => window.dp.resultsSet({ competitionId: pick.value || null }).then(applyOr));
  return pick;
}

function renderResults() {
  const wrap = $('#results');
  const R = S.results;
  if (!R) { wrap.replaceChildren(); return; }
  const comp = R.competitions.find((c) => c.id === R.competitionId) || null;
  const loadedHere = !!(comp && R.roundId && comp.finalId === R.roundId);

  // ---- choose and load ----
  const load = h('button', {
    class: 'primary', disabled: !comp?.ready ? '' : null,
    title: !comp ? 'Choose a competition first' : !comp.ready ? comp.reason
      : S.mode === 'manual' ? 'Uses the final as kept in the offline copy (Manual mode never contacts DanS)' : 'Reads the places of the final from DanS (2 requests)',
    onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Reading…';
      try { applyOr(await window.dp.resultsLoad(comp.id)); } finally { e.target.textContent = loadedHere ? 'Read again' : 'Load results'; e.target.disabled = false; }
    },
  }, loadedHere ? 'Read again' : 'Load results');
  const finalists = R.rows.reduce((n, r) => n + r.competitors.length, 0);
  const info = !comp ? h('span', { class: 'sub' }, 'Results can be read once a competition’s final is finished.')
    : !comp.ready ? h('span', { class: 'warn' }, comp.reason)
      : loadedHere ? h('span', { class: 'src dans' }, `${comp.finalName}: ${finalists} ${R.scope === 'all' ? 'finalists' : 'on places 1–3'}`)
        : h('span', { class: 'sub' }, 'Not read yet');

  // ---- how many are announced ----
  const scope = h('div', { class: 'chips' },
    h('button', { class: 'chip' + (R.scope !== 'all' ? ' active' : ''), title: 'Places 1 to 3; competitors tied on them are all included',
      onclick: () => window.dp.resultsSet({ scope: 'top3' }).then(applyOr) }, 'Top 3'),
    h('button', { class: 'chip' + (R.scope === 'all' ? ' active' : ''), title: 'Every competitor of the final',
      onclick: () => window.dp.resultsSet({ scope: 'all' }).then(applyOr) }, 'Whole final'));

  // ---- reveal ----
  const n = R.total, k = R.step;
  const nextRow = n && k < n ? R.rows[n - k - 1] : null; // rows are best first; the next to reveal is above the revealed ones
  const step = (move) => window.dp.resultsStep(move).then(applyOr);
  const controls = h('div', { class: 'res-controls' },
    h('button', { disabled: !k ? '' : null, title: 'Hide every place again (on screen at once)', onclick: () => step({ step: 0 }) }, 'Hide all'),
    h('button', { disabled: !k ? '' : null, title: 'Take the last revealed place back (Page Up / ←)', onclick: () => step({ delta: -1 }) }, '◀ Back'),
    h('button', { class: 'primary big', disabled: !nextRow ? '' : null, title: 'Show the next place on screen (Page Down / →)', onclick: () => step({ delta: 1 }) },
      nextRow ? `Reveal ${nextRow.label} place ▶` : n ? 'All places shown' : 'Reveal'),
    h('button', { disabled: !n || k === n ? '' : null, title: 'Show the whole ladder at once', onclick: () => step({ step: 'all' }) }, 'Reveal all'),
    h('span', { class: 'sub' }, n ? `${k} of ${n} place${n === 1 ? '' : 's'} on screen` : ''));

  // ---- every place, for reading ahead ----
  const list = R.rows.length ? h('ol', { class: 'res-list' }, R.rows.map((row) => h('li', {
    class: 'res-row' + (row.revealed ? ' shown' : '') + (row === nextRow ? ' next' : ''),
  },
  h('span', { class: 'res-place' }, row.label),
  h('div', { class: 'res-who' }, row.competitors.map((c) => h('div', { class: 'res-c' },
    h('span', { class: 'pj-ph' }, c.photo ? cropImg(c.photo, c.crop) : null),
    h('b', null, c.number || '–'), ' ', c.name || h('span', { class: 'sub' }, 'no name'),
    c.club ? h('span', { class: 'sub' }, ` · ${c.club}`) : null,
    c.sponsor ? h('span', { class: 'sub' }, ` · sponsor: ${c.sponsor}`) : null,
    c.photo ? null : h('span', { class: 'warn' }, ' · no photo')))),
  h('span', { class: 'res-state' }, row.revealed ? 'on screen' : row === nextRow ? 'next' : '')))) : null;

  wrap.replaceChildren(h('section', { class: 'pnl', '--c': S.theme.accent },
    h('div', { class: 'pnl-head' }, h('b', null, 'Results announcement'),
      h('span', { class: 'sub' }, `page Results on port ${S.outputs?.pages.find((p) => p.path === '/out/results.html')?.port || ''}`)),
    h('div', { class: 'pnl-tools' }, h('label', { class: 'comp-pick-l' }, h('b', null, 'Competition '), resultsPicker(R)), load, info),
    h('div', { class: 'pnl-tools' }, h('b', null, 'Announce'), scope),
    loadedHere ? controls : null,
    loadedHere ? h('p', { class: 'hint' }, 'Reveal, Back and Hide all go on screen at once. Choosing a competition or loading it waits for Push competitors (or the first Reveal). A presentation clicker works: Page Down reveals, Page Up goes back.') : null,
    list));
}

// Presentation clicker / keyboard on the Results tab: Page Down or → reveals the next place, Page Up or ← goes back.
// Not while typing in a field or choosing in a list, and not with a dialog open.
document.addEventListener('keydown', (e) => {
  if ($('#tab-results').hidden || document.querySelector('dialog[open]')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const move = { PageDown: 1, ArrowRight: 1, PageUp: -1, ArrowLeft: -1 }[e.key];
  if (!move || !S?.results?.total) return;
  e.preventDefault();
  window.dp.resultsStep({ delta: move }).then(applyOr);
});
