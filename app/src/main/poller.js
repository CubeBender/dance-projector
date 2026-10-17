'use strict';
// Polls DanS (read-only) and keeps the latest raw data. Emits 'raw' after every successful poll.
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
    location: ev.location, date: ev.authorities?.[0]?.date,
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
  start() { this.kick(); this.timer = setInterval(() => this.kick(), 5000); }
  stop() { clearInterval(this.timer); }
  kick() { this.status.lastOk = Date.now(); this.emit('status', this.status); this.emit('raw', this.raw); }
}

module.exports = { Poller, FixturePoller, fetchRaw, eventIdOf };
