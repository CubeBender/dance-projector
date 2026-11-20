'use strict';
// Reading DanS printouts (D-24, 2026-11-20): the parser that matches recognised text against known competitions,
// competitors and judges. The texts below imitate what the text recognition returned for photos of a real DanS
// round start list (junk from the desk, a misread number, garbled diacritics, a judge letter lost) – with made-up
// names only (public repository).
const assert = require('assert');
const P = require('../src/main/printout');
const { mergeCompetitors, fromStartlist } = require('../src/main/competitors');

// ---- helpers ----
assert.strictEqual(P.norm('Šimáčková  Adéla!'), 'simackova adela');
assert.ok(P.similarity('simackova', 'simackovy') > 0.75, 'a typical misreading still scores high');
assert.ok(P.similarity('novak', 'dvorak') < 0.7);
assert.deepStrictEqual(P.findIn('jana novakova', 'x 3 jana novakova klub'.split(' ')), { score: 1, start: 2, end: 4 });

// ---- what the app knows (offline copy + gallery) ----
const known = {
  competitions: [
    { id: 'c1', number: 1, title: 'Do 8 let E Sólo kombinace', rounds: ['1. kolo', 'Finále'] },
    { id: 'c7', number: 7, title: 'Dospělí A Sólo latinskoamerické tance', rounds: ['1. kolo', '2. kolo', 'Semifinále', 'Finále'] },
  ],
  competitors: [
    { key: 'dans:a', label: 'Lukáš Pavlík', people: [{ name: 'Lukáš', surname: 'Pavlík' }] },
    { key: 'dans:b', label: 'Adéla Šimáčková', people: [{ name: 'Adéla', surname: 'Šimáčková' }] },
    { key: 'dans:c', label: 'Ella Marie Veselá', people: [{ name: 'Ella Marie', surname: 'Veselá' }] },
    { key: 'dans:d', label: 'Petr Malý', people: [{ name: 'Petr', surname: 'Malý' }] },
    // a couple of two of the solo dancers above: must not be "found" across two solo rows
    { key: 'dans:x', label: 'Lukáš Pavlík & Adéla Šimáčková', people: [{ name: 'Lukáš', surname: 'Pavlík' }, { name: 'Adéla', surname: 'Šimáčková' }] },
  ],
  judges: [
    { fedId: '91', name: 'Jakub', surname: 'Bartoš' }, { fedId: '92', name: 'Charlotte', surname: 'Horká Tomanová' },
    { fedId: '93', name: 'Jana', surname: 'Krátká' }, { fedId: '94', name: 'Dmytro', surname: 'Melnyk' },
    { fedId: '95', name: 'Jan', surname: 'Plíva' }, { fedId: '96', name: 'Veronika', surname: 'Štefanová Hanáková' },
    { fedId: '97', name: 'Pavel', surname: 'Novotný' },
  ],
};

// ---- a sharp photo of the top of the sheet ----
const sharp = `Startovní listina 1- Do 8 let E Solo SoKOMB : Finále
Pardubický podzimní pohár - L'Oreál Paris Ceský taneční pohár Pardubice - 2026-10-17
N2 Soutěžící Klub Země
1 Lukáš Pavlík KLUB A
2 Adéla Šimáčková KLUB A
3 Ella Marie Veselá KLUB B

Celkem 3 soutěžící.

Porota

B — Jakub Bartoš, H — Charlotte Horká Tomanová, L — Jana Krátká, N — Dmytro Melnyk, R — Pavel Novotný,
U — Jan Plíva, Y — Veronika Štefanová Hanáková

Rozlosování skupin
Jedna skupina, pro tance: Waltz, Chachacha, Polka
1. 1 2 3`;
let r = P.parsePrintout(sharp, known);
assert.strictEqual(r.kind, 'startlist');
assert.deepStrictEqual({ compId: r.header.compId, number: r.header.number, round: r.header.round, sure: r.header.sure }, { compId: 'c1', number: 1, round: 'Finále', sure: true });
assert.deepStrictEqual(r.competitors.map((c) => [c.number, c.key, c.sure]), [['1', 'dans:a', true], ['2', 'dans:b', true], ['3', 'dans:c', true]], 'no couple made of two solo rows');
assert.deepStrictEqual(r.judges.map((j) => j.letter + j.fedId), ['B91', 'H92', 'L93', 'N94', 'R97', 'U95', 'Y96']);
assert.ok(r.judges.every((j) => j.sure));

// ---- a whole page from the webcam: junk, a misread number, garbled names, a lost judge letter ----
const rough = `n: : : Startovní listina 1-Do 8 let E Solo SoKOMB : Finále A :
; zralé : orál: : le Pardubický podzimní pohár - 'Oreál Paris Český taneční pohár. Parádice.202610.17 |
: ; M : Aku „1M Ne Soutěžící Klub Země 3 ý
k 3 Lukás Pavlik KLUB A 4
U zLr: Pl i : : d 2 Adéla Šimačkový KLUB A 3
; : E NEŽSAŮ i SA 3 Ela Marle Veselé KLUB B i
: : : 3 Celkem 3 soutěžící. 4
Porota
: ' : ) val B — Jakub Bartoš, H — Charlotte Horká Tomanová, Jana Krátká, N — Dmytro Melnyk, R — Pavel Novotný. a
; ) : : A U — Jan Plíva, Y — Veronika Štefanová Hanáková A
Rozlosování skupin`;
r = P.parsePrintout(rough, known);
assert.strictEqual(r.header.compId, 'c1', 'header found despite junk around it');
const byKey = Object.fromEntries(r.competitors.map((c) => [c.key, c]));
assert.deepStrictEqual(Object.keys(byKey).sort(), ['dans:a', 'dans:b', 'dans:c']);
assert.strictEqual(byKey['dans:b'].number, '2');
assert.strictEqual(byKey['dans:a'].number, '3', 'the misread number is taken as read…');
assert.ok(!byKey['dans:a'].sure && !byKey['dans:c'].sure, '…but both rows with "3" are marked for checking');
const jk = r.judges.find((j) => j.fedId === '93');
assert.ok(jk && jk.letter === '' && !jk.sure, 'a judge whose letter was lost is still found, marked for checking');
assert.strictEqual(r.judges.length, 7);

// ---- two readings of the same photo combined: the better reading of each row wins ----
const m = P.mergeResults([r, P.parsePrintout(sharp, known)]);
assert.deepStrictEqual(m.competitors.map((c) => [c.number, c.key, c.sure]), [['1', 'dans:a', true], ['2', 'dans:b', true], ['3', 'dans:c', true]]);
assert.strictEqual(m.judges.find((j) => j.fedId === '93').letter, 'L', 'the reading with the letter wins');

// ---- a semifinal of another competition; a round name the offline copy knows ----
r = P.parsePrintout('Startovní listina 7 · Dospělí A Sólo latinskoamerické tance · Semifinále\n12 Petr Malý KLUB C', known);
assert.deepStrictEqual([r.header.compId, r.header.round], ['c7', 'Semifinále']);
assert.deepStrictEqual(r.competitors.map((c) => [c.number, c.key]), [['12', 'dans:d']]);
// a misread competition number: the title still finds it
assert.strictEqual(P.parsePrintout('Startovní listina 4 · Dospělí A Sólo latinskoamerické tance · 2. kolo', known).header.compId, 'c7');
// nothing known: the header is still read as text
r = P.parsePrintout('Startovní listina 22 · Junioři Sólo STT · Finále', known);
assert.deepStrictEqual([r.header.compId, r.header.number, r.header.round], [null, 22, 'Finále']);

// ---- a number read from a printout is the competitor's number (DanS has none in the offline copy) ----
const dans = fromStartlist([{ id: 'a', number: null, people: { Persons: [{ name: 'Lukáš', surname: 'Pavlík', in_authority_id: { id: '1' } }] } },
  { id: 'b', number: 5, people: { Persons: [{ name: 'Adéla', surname: 'Šimáčková', in_authority_id: { id: '2' } }] } }]);
const list = mergeCompetitors(dans, { 'dans:a': { printNumber: '14' }, 'dans:b': { printNumber: '6' } });
assert.deepStrictEqual(list.map((c) => [c.key, c.number, c.numberFrom]), [['dans:b', '6', 'print'], ['dans:a', '14', 'print']],
  'the printed number wins over the offline copy (the sheet is newer)');

console.log('printout: all tests passed');
