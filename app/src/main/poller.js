'use strict';
// Reads DanS (read-only) and keeps the latest raw data. Emits 'raw' after every successful read and
// 'status' after every attempt.
//
// Two ways to use it, matching the data modes (D-13):
//   automatic – start(): reads every intervalMs until stop()
//   on demand – fetchOnce(): one read when the operator presses Fetch now; nothing happens otherwise
const { EventEmitter } = require('events');
const { pickRoundId } = require('./roundpick');

function eventIdOf(ev) { return ev?.authorities?.[0]?.event_id || ev?.id || null; }

// One complete read of an event. Used by the poller (slow parts) and the snapshot script.
async function fetchRaw(dans, ev, { allDraws = false } = {}) {
  const e = eventIdOf(ev);
  const [indexes, competitions, judges, allocation, startlist] = await Promise.all([
    dans.indexes(e), dans.competitions(e), dans.judges(e), dans.allocation(e), dans.startlist(e),
  ]);
  const draws = {};
  if (allDraws) {
    for (const c of competitions) {
      const rid = pickRoundId(c);
      if (rid) draws[rid] = await dans.draw(e, rid);
    }
  }
  return { event: slimEvent(ev), indexes, competitions, judges, allocation, startlist, draws, fetchedAt: Date.now() };
}

function slimEvent(ev) {
  return {
    id: eventIdOf(ev), name: ev.name, abbreviation: ev.abbreviation,
    location: ev.location, date: ev.date ?? ev.authorities?.[0]?.date, // ev may already be slim (offline copy)
    days: ev.days ?? ev.authorities?.[0]?.days ?? 1, // how long the event lasts: competitor photos go after it (D-30)
  };
}

class Poller extends EventEmitter {
  constructor({ dans, intervalMs = 2000, slowEveryMs = 15000 }) {
    super();
    this.dans = dans;
    this.intervalMs = intervalMs;
    this.slowEveryMs = slowEveryMs;
    this.event = null;
    this.raw = null;
    this.lastSlow = 0;
    this.wantedRounds = () => [];
    // Rounds being danced now (heat tracking, D-29). Automatic mode reads their judges' marks on every poll, and
    // their draw (who dances in which heat) once per round. Set by main.js.
    this.liveRounds = () => [];
    this.timer = null;
    this.status = { connected: false, error: null, lastOk: null };
  }

  setClient(dans) { this.dans = dans; this.raw = null; this.lastSlow = 0; }
  setEvent(ev) { this.event = ev; this.raw = null; this.lastSlow = 0; this.kick(); }
  // Starts from data we already have (the offline copy), so an on-demand fetch only needs the parts that
  // change shortly before a competition.
  seed(ev, raw) { this.event = ev; this.raw = raw; this.lastSlow = raw ? Date.now() : 0; }

  // On-demand read. First time (no data yet): everything. Afterwards only what changes when a panel is drawn:
  // competitions (rounds, states, round judges), the event's judge list and the judge allocation.
  // That is 3 GET requests per press.
  async fetchOnce() {
    if (!this.event) throw new Error('Choose an event first');
    if (this.busy) throw new Error('A read is already running');
    this.busy = true;
    try {
      const e = eventIdOf(this.event);
      if (!this.raw) this.raw = await fetchRaw(this.dans, this.event);
      else {
        const [competitions, judges, allocation] = await Promise.all([this.dans.competitions(e), this.dans.judges(e), this.dans.allocation(e)]);
        Object.assign(this.raw, { competitions, judges, allocation });
      }
      this.raw.fetchedAt = Date.now();
      this.status = { connected: true, error: null, lastOk: this.raw.fetchedAt };
      this.emit('raw', this.raw);
    } catch (err) {
      this.status = { ...this.status, connected: false, error: String(err.message || err) };
      throw err;
    } finally {
      this.busy = false;
      this.emit('status', this.status);
    }
  }

  // Competitors of one round (Competitors tab, "Load from DanS round", decision C-36): the event's start list
  // (names and numbers) and the draw of that round (who dances in it). 2 GET requests. The result is kept in the
  // raw data like any other read, so it lands in the offline copy too. Returns the draw.
  async fetchRoundCompetitors(roundId) {
    if (!this.event) throw new Error('Choose an event first');
    if (!this.raw) throw new Error('Fetch the event data first');
    const e = eventIdOf(this.event);
    try {
      const [startlist, draw] = await Promise.all([this.dans.startlist(e), this.dans.draw(e, roundId)]);
      this.raw.startlist = startlist;
      this.raw.draws = { ...(this.raw.draws || {}), [roundId]: draw };
      this.status = { connected: true, error: null, lastOk: Date.now() };
      this.emit('raw', this.raw);
      return draw;
    } catch (err) {
      this.status = { ...this.status, connected: false, error: String(err.message || err) };
      throw err;
    } finally { this.emit('status', this.status); }
  }

  // Results of a finished competition (Results tab, decision D-26): the start list (names, clubs, sponsors) and the
  // draw of the FINAL round, which carries each finalist's place (ranking / ranking_to). 2 GET requests, the same
  // read-only ones as fetchRoundCompetitors. Kept in raw.results, not raw.draws: automatic mode rebuilds raw.draws on
  // every poll from the rounds on screen, which would drop a final read here. Lands in the offline copy too.
  async fetchResults(roundId) {
    if (!this.event) throw new Error('Choose an event first');
    if (!this.raw) throw new Error('Fetch the event data first');
    const e = eventIdOf(this.event);
    try {
      const [startlist, draw] = await Promise.all([this.dans.startlist(e), this.dans.draw(e, roundId)]);
      this.raw.startlist = startlist;
      this.raw.results = { ...(this.raw.results || {}), [roundId]: draw };
      this.status = { connected: true, error: null, lastOk: Date.now() };
      this.emit('raw', this.raw);
      return draw;
    } catch (err) {
      this.status = { ...this.status, connected: false, error: String(err.message || err) };
      throw err;
    } finally { this.emit('status', this.status); }
  }

  // Start list only (Competitors tab, "Refresh start list"): 1 GET request. Fetch now reads the start list only on
  // the first read, but start numbers arrive later, when competition staff give them in DanS (D-23).
  async fetchStartlist() {
    if (!this.event) throw new Error('Choose an event first');
    const e = eventIdOf(this.event);
    try {
      const startlist = await this.dans.startlist(e);
      if (!this.raw) this.raw = await fetchRaw(this.dans, this.event); // nothing read yet: everything once
      else this.raw.startlist = startlist;
      this.status = { connected: true, error: null, lastOk: Date.now() };
      this.emit('raw', this.raw);
    } catch (err) {
      this.status = { ...this.status, connected: false, error: String(err.message || err) };
      throw err;
    } finally { this.emit('status', this.status); }
  }

  start() { this.running = true; this.kick(); }
  stop() { this.running = false; clearTimeout(this.timer); this.timer = null; }
  // Run a poll now. Only one poll is ever in flight; a kick during a poll schedules one more right after.
  kick() {
    if (!this.running) return;
    if (this.busy) { this.again = true; return; }
    clearTimeout(this.timer); this.timer = null;
    this.loop();
  }

  async loop() {
    this.busy = true;
    try {
      await this.tick();
      this.status = { connected: true, error: null, lastOk: Date.now() };
    } catch (err) {
      this.status = { ...this.status, connected: false, error: String(err.message || err) };
    }
    this.busy = false;
    this.emit('status', this.status);
    if (!this.running) return;
    const delay = this.again ? 0 : this.intervalMs;
    this.again = false;
    this.timer = setTimeout(() => this.loop(), delay);
  }

  async tick() {
    if (!this.event) return;
    const e = eventIdOf(this.event);
    const now = Date.now();
    // Draws read before (Load from DanS round, heat tracking) stay: a full read starts with no draws, and losing them
    // would make the competitor list and the heats forget who dances in a round until it is read again.
    const oldDraws = this.raw?.draws || {};
    if (!this.raw || now - this.lastSlow > this.slowEveryMs) {
      const results = this.raw?.results; // read only on request (Results tab): a full read must not lose them
      this.raw = await fetchRaw(this.dans, this.event);
      if (results) this.raw.results = results;
      this.lastSlow = now;
    } else {
      this.raw.competitions = await this.dans.competitions(e);
    }
    const draws = { ...oldDraws };
    for (const rid of new Set(this.wantedRounds(this.raw))) {
      try { draws[rid] = await this.dans.draw(e, rid); } catch { /* keep the one read before, if any */ }
    }
    // Heat tracking (D-29): for each round being danced, its draw once (the heats don't change during a round) and
    // its marks on every poll (1 GET per round). A round that fails to read is skipped this time.
    const live = {};
    for (const rid of new Set(this.liveRounds(this.raw))) {
      try {
        if (!draws[rid]) draws[rid] = await this.dans.draw(e, rid);
        live[rid] = { marks: await this.dans.marks(e, rid), at: now };
      } catch { /* not this time; the tracker keeps its last position */ }
    }
    this.raw.draws = draws;
    this.raw.live = live;
    this.raw.fetchedAt = now;
    this.emit('raw', this.raw);
  }
}

// Plays back a fixture file instead of talking to DanS.
class FixturePoller extends EventEmitter {
  constructor(raw) { super(); this.raw = raw; this.event = raw.event; this.status = { connected: true, error: null, lastOk: Date.now(), fixture: true }; this.wantedRounds = () => []; this.liveRounds = () => []; }
  setClient() {}
  setEvent() { this.kick(); }
  seed() {}
  async fetchOnce() { this.kick(); }
  // the fixture holds draws of a few rounds only; others come back empty
  async fetchRoundCompetitors(roundId) { return this.raw.draws?.[roundId] || { competitors: [] }; }
  // a finished final in a snapshot: its draw is under results (or draws, for older snapshots)
  async fetchResults(roundId) { return this.raw.results?.[roundId] || this.raw.draws?.[roundId] || { competitors: [] }; }
  async fetchStartlist() { this.kick(); }
  start() { this.kick(); this.timer = setInterval(() => this.kick(), 5000); }
  stop() { clearInterval(this.timer); }
  kick() { this.status.lastOk = Date.now(); this.emit('status', this.status); this.emit('raw', this.raw); }
}

module.exports = { Poller, FixturePoller, fetchRaw, eventIdOf };
