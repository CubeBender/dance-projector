'use strict';
// Looks up a dancer at the Czech federation (ČSTS, csts.cz) by their IDT – decision C-33.
//
// The public web site of ČSTS reads its member registry from a JSON API that needs no login:
//   GET https://www.csts.cz/api/members/{IDT}     -> { idt, name, surname, clubName, … }   (used first)
//   GET https://www.csts.cz/api/1/athletes/{IDT}  -> { collection: [{ name: "Surname Name", … }] }   (fallback)
// Only the IDT leaves this computer. ČSTS limits how often it may be asked (HTTP 429), so:
//   - one request at a time (a second lookup waits for the first),
//   - only when the operator presses Find (never in the background),
//   - answers are remembered until the app is closed.
const { parseCstsMember, parseCstsAthlete } = require('./competitors');

const BASE = 'https://www.csts.cz';
const cache = new Map();       // IDT -> answer (or null = not found)
let queue = Promise.resolve(); // chains the requests so only one runs at a time

class CstsError extends Error {}

async function getJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'DanceProjector/0.1' }, signal: ctrl.signal });
    if (res.status === 429) throw new CstsError('ČSTS is limiting requests right now. Try again in a minute.');
    if (res.status === 404 || res.status === 204) return null;
    if (!res.ok) throw new CstsError(`ČSTS answered ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e instanceof CstsError) throw e;
    if (e.name === 'AbortError') throw new CstsError(`ČSTS did not answer within ${timeoutMs / 1000} s`);
    if (e instanceof SyntaxError) throw new CstsError('ČSTS sent an answer the app does not understand');
    throw new CstsError('Cannot reach csts.cz – is this computer online?');
  } finally { clearTimeout(t); }
}

// Returns { idt, name, surname, club, guessed? } or null when ČSTS has no such IDT. Throws CstsError with a
// message for the operator when ČSTS can't be asked.
// guessed = the name came from the one-string fallback, so name/surname may be the wrong way round.
function lookup(idt, { timeoutMs = 8000 } = {}) {
  idt = String(idt || '').trim();
  if (!/^\d{5,10}$/.test(idt)) return Promise.reject(new CstsError('An IDT is a number of 5 to 10 digits'));
  if (cache.has(idt)) return Promise.resolve(cache.get(idt));
  const run = async () => {
    if (cache.has(idt)) return cache.get(idt); // answered while this one waited in the queue
    let found = parseCstsMember(await getJson(`${BASE}/api/members/${idt}`, timeoutMs));
    if (!found) found = parseCstsAthlete(await getJson(`${BASE}/api/1/athletes/${idt}`, timeoutMs));
    if (found) found.idt = idt;
    cache.set(idt, found || null);
    return found || null;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {}); // a failed lookup must not block the next one
  return p;
}

module.exports = { lookup, CstsError };
