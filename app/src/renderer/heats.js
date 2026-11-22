'use strict';
// Heats tab (decision D-29): which heat of each running round is on the floor now and which one is next. Loaded after
// app.js and uses its helpers ($, h, S, apply, applyOr): classic scripts share their top-level names.
//
// Where the position comes from (main/heattrack.js):
//   * automatic mode reads the judges' marks every 2 s: the latest heat crossed by enough different judges (a third
//     of the panel, at least 2) is the one being danced, so one judge lagging behind or one wrong number doesn't move
//     it; dances the judges have submitted or DanS has finished move it on to the next dance;
//   * the operator's Next heat / Back always win, until the marks move past where they were at that moment.
// Nothing here goes on screen: it is for the operator only. The judges' marks are confidential until the results
// are out, so the tab shows only how many judges have crossed in a heat, never whom.
// A presentation clicker works on this tab: Page Down / → = Next heat, Page Up / ← = Back, for the selected round.

let hsel = null; // round the clicker keys move (click a round's card to choose it; the first one otherwise)

// "Cha heat 2 / 3" – one heat in words
const heatWords = (x) => (x ? `${x.danceName || x.dance} · heat ${x.heat} of ${x.heatCount}` : '');
const numbersText = (nums) => (nums.length ? nums.filter((n) => n != null).join('  ') : 'heats not read yet');

// Why the position is where it is, for the line under Now / Next.
function sourceLine(R) {
  if (R.source === 'operator') return h('span', { class: 'src manual' }, 'Set by you');
  if (R.source === 'dans') return h('span', { class: 'src dans', title: `A heat counts once ${R.quorum} different judges have crossed in it` }, R.reason ? `From DanS: ${R.reason}` : 'From DanS');
  return h('span', { class: 'src' }, 'Start of the round');
}

function heatRound(R) {
  const move = (dir) => window.dp.heatMove(R.roundId, dir).then(applyOr);
  const big = (label, x, cls) => h('div', { class: 'heat-big ' + cls },
    h('small', null, label),
    x ? h('b', null, heatWords(x)) : h('b', null, label === 'Next' ? 'End of the round' : '–'),
    x ? h('div', { class: 'heat-nums' }, numbersText(x.numbers)) : null);

  // every dance as a column, its heats below: done / now / next, with how many judges have crossed there
  const grid = h('div', { class: 'heat-grid' }, R.dances.map((dn) => h('div', { class: 'heat-col' + (dn.completed ? ' finished' : '') },
    h('div', { class: 'heat-dance', title: dn.completed ? 'Finished in DanS' : '' }, dn.abbr || dn.name, dn.completed ? ' ✓' : ''),
    dn.heats.map((ht) => h('div', { class: 'heat-cell ' + ht.state },
      h('div', { class: 'heat-cell-head' }, h('b', null, `Heat ${ht.heat}`),
        h('span', { class: 'sub', title: 'Different judges who have crossed somebody in this heat' }, `${ht.marked}/${R.judgeCount || '?'}`),
        ht.state === 'now' ? h('span', { class: 'tag now' }, 'now') : ht.state === 'next' ? h('span', { class: 'tag next' }, 'next') : null),
      ht.marking.length ? h('div', { class: 'heat-marking', title: 'Judges who crossed here in the last 20 s' }, `crossing now: ${ht.marking.length}`) : null,
      h('div', { class: 'heat-cell-nums' }, numbersText(ht.numbers)))))));

  return h('section', { class: 'pnl heat-round' + (R.roundId === hsel ? ' sel' : ''), '--c': S.theme.accent,
    onclick: (e) => { if (!e.target.closest('button, input, label')) { hsel = R.roundId; renderHeats(); } } },
  h('div', { class: 'pnl-head' },
    R.slot && S.config.split ? h('span', { class: 'slot-key' }, R.slot) : null,
    h('b', null, `${R.number} · ${R.title}`), h('span', { class: 'sub' }, R.roundName),
    R.roundDone ? h('span', { class: 'tag' }, 'every dance finished') : null),
  h('div', { class: 'heat-now' }, big('Now', R.now, 'now'), big('Next', R.next, 'next')),
  h('div', { class: 'pnl-tools' },
    h('button', { title: 'One heat back (Page Up / ←)', onclick: () => move(-1) }, '◀ Back'),
    h('button', { class: 'primary', title: 'The next heat has started (Page Down / →)', onclick: () => move(1) }, 'Next heat ▶'),
    h('label', { class: 'row small', title: 'Off: only Next heat / Back move this round' },
      h('input', { type: 'checkbox', checked: R.auto ? '' : null, onchange: (e) => window.dp.heatAuto(R.roundId, e.target.checked).then(applyOr) }),
      ' Follow the judges’ marks'),
    sourceLine(R)),
  grid);
}

function renderHeats() {
  const wrap = $('#heats');
  const H = S.heats || { rounds: [], live: false };
  if (!H.rounds.some((r) => r.roundId === hsel)) hsel = H.rounds[0]?.roundId || null;
  const hint = H.live
    ? 'Reads the judges’ marks every 2 s. A heat counts as danced once a third of the judges (at least 2) have crossed somebody in it, so one judge lagging behind or crossing a wrong number doesn’t move it. Next heat / Back always win until the marks move further.'
    : 'Only Automatic mode reads the judges’ marks. Now the position moves with Next heat / Back, and with the dances DanS has finished (at the last read).';
  wrap.replaceChildren(
    h('p', { class: 'hint' }, hint, ' A presentation clicker works here: Page Down = Next heat, Page Up = Back, for the highlighted round.'),
    ...(H.rounds.length ? H.rounds.map(heatRound)
      : [h('p', { class: 'empty' }, 'No round is being danced. A round counts once judging is enabled for it in DanS.')]));
}

// The floor boxes in the side panel: one short line, heat now and next, under the competition on that side.
function heatLineFor(compId) {
  const R = S.heats?.rounds.find((r) => r.competitionId === compId);
  if (!R?.now) return null;
  return h('div', { class: 'heat-line' },
    h('b', null, `${R.now.dance} heat ${R.now.heat}/${R.now.heatCount}`),
    R.next ? ` · next ${R.next.dance === R.now.dance ? '' : R.next.dance + ' '}heat ${R.next.heat}` : ' · last heat',
    R.source === 'operator' ? h('span', { class: 'sub' }, ' (set by you)') : null);
}

// Clicker / keyboard on the Heats tab. Not while typing, choosing in a list, or with a dialog open.
document.addEventListener('keydown', (e) => {
  if ($('#tab-heats').hidden || document.querySelector('dialog[open]')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const dir = { PageDown: 1, ArrowRight: 1, PageUp: -1, ArrowLeft: -1 }[e.key];
  if (!dir || !hsel) return;
  e.preventDefault();
  window.dp.heatMove(hsel, dir).then(applyOr);
});
