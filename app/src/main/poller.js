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
    if (!this.raw || now - this.lastSlow > this.slowEveryMs) {
      this.raw = await fetchRaw(this.dans, this.event);
      this.lastSlow = now;
    } else {
      this.raw.competitions = await this.dans.competitions(e);
    }
    const draws = {};
    for (const rid of new Set(this.wantedRounds(this.raw))) {
      try { draws[rid] = await this.dans.draw(e, rid); } catch { if (this.raw.draws?.[rid]) draws[rid] = this.raw.draws[rid]; }
    }
    this.raw.draws = draws;
    this.raw.fetchedAt = now;
    this.emit('raw', this.raw);
  }
}

// Plays back a fixture file instead of talking to DanS.
class FixturePoller extends EventEmitter {
  constructor(raw) { super(); this.raw = raw; this.event = raw.event; this.status = { connected: true, error: null, lastOk: Date.now(), fixture: true }; this.wantedRounds = () => []; }
  setClient() {}
  setEvent() { this.kick(); }
  seed() {}
  async fetchOnce() { this.kick(); }
  // the fixture holds draws of a few rounds only; others come back empty
  async fetchRoundCompetitors(roundId) { return this.raw.draws?.[roundId] || { competitors: [] }; }
  async fetchStartlist() { this.kick(); }
  start() { this.kick(); this.timer = setInterval(() => this.kick(), 5000); }
  stop() { clearInterval(this.timer); }
  kick() { this.status.lastOk = Date.now(); this.emit('status', this.status); this.emit('raw', this.raw); }
}

module.exports = { Poller, FixturePoller, fetchRaw, eventIdOf };
