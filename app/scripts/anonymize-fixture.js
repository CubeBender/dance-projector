'use strict';
// Makes a shareable fixture from a real DanS snapshot: every person gets a made-up name and ID,
// clubs become "Klub N", judge exclusions are dropped. Structure, numbers, heats and allocation stay
// identical, so tests and design work behave exactly like with the real data.
//
// usage: node scripts/anonymize-fixture.js [in: fixtures/private/pardubice.json] [out: fixtures/sample.json]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const inFile = process.argv[2] || path.join(__dirname, '..', 'fixtures', 'private', 'pardubice.json');
const outFile = process.argv[3] || path.join(__dirname, '..', 'fixtures', 'sample.json');
const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));

const FIRST = ['Adam', 'Bára', 'Cyril', 'Dana', 'Emil', 'Fiona', 'Gustav', 'Hana', 'Ivo', 'Jana', 'Karel', 'Lenka', 'Marek',
  'Nela', 'Oto', 'Petra', 'Radek', 'Simona', 'Tomáš', 'Ulrika', 'Václav', 'Wanda', 'Xenie', 'Yvona', 'Zdeněk', 'Šárka', 'Žofie', 'Řehoř'];
const LAST = ['Antošová', 'Beneš', 'Cibulková', 'Dvořák', 'Erbenová', 'Fiala', 'Hájková', 'Ibl', 'Jelínková', 'Kříž', 'Lacinová',
  'Mráz', 'Nováková', 'Orel', 'Pokorná', 'Růžička', 'Sedláková', 'Toman', 'Urbanová', 'Vlček', 'Zemanová', 'Šindelář', 'Žáková', 'Čermák'];

const h = (s) => crypto.createHash('sha256').update('dance-projector:' + s).digest().readUInt32BE(0);
const fakeName = (key) => ({ name: FIRST[h('f' + key) % FIRST.length], surname: LAST[h('l' + key) % LAST.length] });
const fedIds = new Map();
const fakeFedId = (real) => { if (!fedIds.has(real)) fedIds.set(real, String(90000000 + fedIds.size + 1)); return fedIds.get(real); };
const clubs = new Map();
const fakeClub = (real) => { if (!real) return real; if (!clubs.has(real)) clubs.set(real, `Klub ${clubs.size + 1}`); return clubs.get(real); };

// Replace every {name, surname} person object and its federation ID, anywhere in the tree.
function scrubPeople(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(scrubPeople); return; }
  if (typeof node.name === 'string' && typeof node.surname === 'string') {
    Object.assign(node, fakeName(node.id || node.name + node.surname));
    if (node.in_authority_id?.id) node.in_authority_id.id = fakeFedId(node.in_authority_id.id);
    if ('code' in node) node.code = null;
  }
  for (const v of Object.values(node)) scrubPeople(v);
}

for (const s of raw.startlist || []) {
  s.club = fakeClub(s.club);
  s.sponsor = null; s.captain = null; s.nickname = null;
  if (s.name) s.name = `Team ${fakeClub(s.name)}`;
  if (s.in_authority_id?.id) s.in_authority_id.id = fakeFedId('c' + s.in_authority_id.id);
  scrubPeople(s.people);
}
for (const j of raw.judges || []) {
  delete j.pin;
  j.exclusions = [];
  scrubPeople(j.person_display);
}
delete raw.registrations;

// Safety net: none of the original personal strings may survive.
const before = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const secrets = new Set();
for (const s of before.startlist || []) { if (s.club) secrets.add(s.club); JSON.stringify(s.people, (k, v) => { if ((k === 'surname') && v && v.length > 3) secrets.add(v); return v; }); }
for (const j of before.judges || []) { const p = j.person_display || {}; if (p.surname?.length > 3) secrets.add(p.surname); if (p.in_authority_id?.id) secrets.add(p.in_authority_id.id); }
const out = JSON.stringify(raw, null, 1);
const leaks = [...secrets].filter((s) => !LAST.includes(s) && out.includes(`"${s}"`));
if (leaks.length) { console.error('Refusing to write, personal data still present:', leaks.slice(0, 5)); process.exit(1); }

fs.writeFileSync(outFile, out);
console.log(`saved ${outFile}: ${raw.startlist.length} competitors, ${raw.judges.length} judges, ${clubs.size} clubs anonymised`);
