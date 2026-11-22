'use strict';
// Prints a heat log (D-29) as a timeline, to check after an event how live the judges' marks really are.
//
//   node scripts/heatlog.js "%APPDATA%\dance-projector\heatlog\2026-11-28.jsonl" [competition number]
//
// The app writes one line per poll in which something changed in a running round (main.js logHeats). Each line here
// shows the time, the competition and round, what the judges did (who crossed whom in which heat, who submitted a
// dance), the judges' tablets when they changed, and where the app put the round. What to look for:
//   * crosses arriving a few at a time during a heat = the tablets send them live (the tracker can follow heats);
//     all crosses of a dance arriving at once = they are sent on submit only (only dances can be followed);
//   * how long after the music starts a heat reaches the quorum (the "now" line changing);
//   * strays: a single cross in a heat far from the others (wrong number).
// The log holds real start numbers: it stays in the app's data folder, never in the repository.
const fs = require('fs');

const [file, only] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/heatlog.js <heatlog file> [competition number]'); process.exit(1); }

let lastTablets = new Map(), lastNow = new Map();
for (const text of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!text.trim()) continue;
  const l = JSON.parse(text);
  if (only && String(l.competition) !== String(only)) continue;
  const key = `${l.competition}/${l.round}`;
  const time = l.t.slice(11, 19);
  const head = `${time}  ${String(l.competition).padStart(3)} ${l.round.padEnd(4)}`;
  if (l.first) console.log(`${head}  first read: ${l.changed} marks there already`);
  else {
    // crosses grouped by dance and heat: "C heat 2: A×3 C×1"
    const groups = new Map();
    for (const m of l.changed || []) {
      const g = m.submitted ? `submitted ${m.submitted}` : m.roundDone ? 'round submitted' : `${m.dance} heat ${m.heat ?? '?'}${m.value === '{"Cross":true}' ? '' : ' ' + m.value}`;
      if (!groups.has(g)) groups.set(g, new Map());
      groups.get(g).set(m.judge, (groups.get(g).get(m.judge) || 0) + 1);
    }
    for (const m of l.removed || []) {
      const g = `${m.dance || m.submitted || 'round'} heat ${m.heat ?? '?'} removed`;
      if (!groups.has(g)) groups.set(g, new Map());
      groups.get(g).set(m.judge, (groups.get(g).get(m.judge) || 0) + 1);
    }
    const what = [...groups].map(([g, js]) => `${g}: ${[...js].map(([j, n]) => (n > 1 ? `${j}×${n}` : j)).join(' ')}`).join(' | ');
    if (what) console.log(`${head}  ${what}`);
  }
  if (l.tablets !== lastTablets.get(key)) { console.log(`${' '.repeat(head.length)}  tablets: ${l.tablets}`); lastTablets.set(key, l.tablets); }
  const now = `${l.now} → next ${l.next}`;
  if (now !== lastNow.get(key)) { console.log(`${' '.repeat(head.length)}  ▶ now ${now}  (${l.source}${l.reason ? ': ' + l.reason : ''})`); lastNow.set(key, now); }
}
