'use strict';
// HTTP server for the OBS output pages.
//
//   /out/…        output pages (judges, floor overview, schedule, lower third, …) from src/outputs
//   /brand/…      the OBS branding pages from obs/pages (background, logo, …), so the app's preview can show them
//   /photos/…     judge photos            /media/…  background images of the styles
//   /api/state    the JSON the pages draw from. Two channels:
//                   live  (default)   – what was pushed to the projection; this is what OBS shows
//                   draft (?view=draft) – what the operator is preparing; only the app's preview asks for it
//
// Read-only: GET only, files only from the folders above.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

// Joins a URL path onto a folder and refuses anything that would leave the folder ("../").
function safeJoin(root, rel) {
  if (!root) return null;
  const p = path.normalize(path.join(root, decodeURIComponent(rel)));
  return p.startsWith(path.normalize(root + path.sep)) ? p : null;
}

class OutputServer {
  constructor({ outputsDir, photoDir, mediaDir = null, brandDir = null }) {
    this.outputsDir = outputsDir;
    this.photoDir = photoDir;
    this.mediaDir = mediaDir;
    this.brandDir = brandDir;
    // One entry per channel: the state, its JSON and a version number that grows with every real change.
    this.channels = { live: this.emptyChannel(), draft: this.emptyChannel() };
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.keepAliveTimeout = 5000; // idle keep-alive sockets are released quickly
  }

  emptyChannel() { return { state: { slots: {} }, json: '{"slots":{},"version":0}', compare: null, version: 0 }; }

  // Kept for the tests and older callers: the live channel's version.
  get version() { return this.channels.live.version; }

  listen(port, host) {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve(this.server.address()));
    });
  }

  close() { this.server.close(); }

  // Stores a new state for a channel. Identical content (ignoring the timestamp) keeps the version,
  // so the pages see "204 nothing changed" and don't redraw.
  publish(state, channel = 'live') {
    const ch = this.channels[channel];
    const compare = JSON.stringify({ ...state, updated: undefined });
    if (compare === ch.compare) return;
    ch.compare = compare;
    ch.state = state;
    ch.version += 1;
    ch.json = JSON.stringify({ ...state, version: ch.version });
  }

  serveFile(res, file, extraHeaders = {}) {
    if (!file) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache', ...extraHeaders });
      res.end(buf);
    });
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    // The branding pages in OBS are local files (file://), so their requests to us are cross-origin.
    // Everything here is read-only display data, so any origin may read it.
    const cors = { 'access-control-allow-origin': '*' };
    if (p === '/') { res.writeHead(302, { location: '/out/' }).end(); return; }
    // Pages poll this (?since=<version>); 204 = nothing changed. Polling instead of a held-open stream matters:
    // all OBS browser sources share one browser with a limit of 6 connections per host, and open streams
    // used up that limit so photos and other requests never loaded.
    if (p === '/api/state') {
      const ch = this.channels[url.searchParams.get('view') === 'draft' ? 'draft' : 'live'];
      const headers = { 'cache-control': 'no-store', ...cors };
      if (ch.version && Number(url.searchParams.get('since')) === ch.version) { res.writeHead(204, headers).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', ...headers }).end(ch.json); return;
    }
    // No held-open streams on purpose (OBS shares 6 connections per host across all browser sources).
    if (p === '/events') { res.writeHead(410, { 'cache-control': 'no-store' }).end('gone: poll /api/state'); return; }
    if (p.startsWith('/photos/')) return this.serveFile(res, safeJoin(this.photoDir, p.slice(8)), cors);
    if (p.startsWith('/media/')) return this.serveFile(res, safeJoin(this.mediaDir, p.slice(7)), cors);
    if (p.startsWith('/brand/')) return this.serveFile(res, safeJoin(this.brandDir, p.slice(7)));
    if (p === '/out' || p === '/out/') return this.serveFile(res, path.join(this.outputsDir, 'index.html'));
    if (p.startsWith('/out/')) return this.serveFile(res, safeJoin(this.outputsDir, p.slice(5)));
    res.writeHead(404).end('not found');
  }
}

module.exports = { OutputServer };
