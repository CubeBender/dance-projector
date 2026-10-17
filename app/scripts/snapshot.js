'use strict';
// Record one full read of a DanS event into a fixture file (GET only).
// usage: node scripts/snapshot.js [server] [event abbreviation or id] [out file]
const fs = require('fs');
const path = require('path');
const { DansClient } = require('../src/main/dans');
const { fetchRaw } = require('../src/main/poller');

(async () => {
  const server = process.argv[2] || 'http://localhost:8686';
  const which = process.argv[3] || 'CS1761';
  const out = process.argv[4] || path.join(__dirname, '..', 'fixtures', 'pardubice.json');
  const dans = new DansClient(server);
  const events = await dans.events();
  const ev = events.find((e) => e.abbreviation === which || e.authorities?.[0]?.event_id === which);
  if (!ev) throw new Error(`event ${which} not found`);
  const raw = await fetchRaw(dans, ev, { allDraws: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(raw, null, 1));
  console.log(`saved ${out}: ${raw.competitions.length} competitions, ${raw.judges.length} judges, ${Object.keys(raw.draws).length} draws`);
})().catch((e) => { console.error(e); process.exit(1); });
