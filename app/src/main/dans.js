'use strict';
// Read-only DanS client. See DANS_KNOWLEDGEBASE.md and Docs/dans-client/SPEC.md.
//
// Safety: only GET, and only paths on an explicit allow-list. Anything else throws before a request
// is made, so this client cannot change DanS data or deliver results to the federation.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALLOWED = [
  /^\/events(\?order=[%+\w]+)?$/,
  /^\/competitions$/,
  new RegExp(`^/events/${UUID}/(judges|officials|officials/competitions|startlist)(\\?order=[%+\\w]+)?$`),
  new RegExp(`^/rounds/${UUID}/draw/competitors$`),
  /^\/index_(age|class|discipline|dance|official_role|series)$/,
];

function assertAllowed(path) {
  if (!ALLOWED.some((re) => re.test(path))) {
    throw new Error(`DanS path not on the read-only allow-list: ${path}`);
  }
}

class DansClient {
  constructor(baseUrl, { timeoutMs = 8000 } = {}) {
    this.base = String(baseUrl || '').replace(/\/+$/, '') + '/api/1';
    this.timeoutMs = timeoutMs;
  }

  async get(path, eventId) {
    assertAllowed(path);
    const headers = { accept: 'application/json' };
    if (eventId) headers['dans-event'] = eventId;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.base + path, { method: 'GET', headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(`DanS ${res.status} for ${path}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async list(path, eventId) {
    const body = await this.get(path, eventId);
    return body.collection || [];
  }

  events() { return this.list('/events?order=%2bnord'); }
  competitions(e) { return this.list('/competitions', e); }
  allocation(e) { return this.list(`/events/${e}/officials/competitions`, e); }
  startlist(e) { return this.list(`/events/${e}/startlist`, e); }
  async draw(e, roundId) { return (await this.get(`/rounds/${roundId}/draw/competitors`, e)).entity; }

  async judges(e) {
    // Drop tablet PINs immediately; they must never be stored or shown.
    return (await this.list(`/events/${e}/judges`, e)).map(({ pin, ...rest }) => rest);
  }

  async indexes(e) {
    const names = ['age', 'class', 'discipline', 'dance', 'official_role'];
    const out = {};
    for (const n of names) out[n] = await this.list(`/index_${n}`, e);
    return out;
  }
}

module.exports = { DansClient, assertAllowed };
