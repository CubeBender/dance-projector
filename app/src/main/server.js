'use strict';
// HTTP server for the OBS output pages: static pages, judge photos, JSON state and live push (SSE).
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function safeJoin(root, rel) {
  const p = path.normalize(path.join(root, decodeURIComponent(rel)));
  return p.startsWith(path.normalize(root + path.sep)) ? p : null;
}

class OutputServer {
  constructor({ outputsDir, photoDir }) {
    this.outputsDir = outputsDir;
    this.photoDir = photoDir;
    this.clients = new Set();
    this.state = { slots: {} };
    this.json = JSON.stringify(this.state);
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.keepAliveTimeout = 5000; // idle keep-alive sockets are released quickly
  }

  listen(port, host) {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve(this.server.address()));
    });
  }

  close() { for (const c of this.clients) c.end(); this.server.close(); }

  publish(state) {
    const json = JSON.stringify({ ...state, updated: undefined });
    if (json === this.lastCompare) return; // skip identical updates so pages don't re-render
    this.lastCompare = json;
    this.state = state;
    this.version = (this.version || 0) + 1;
    this.json = JSON.stringify({ ...state, version: this.version });
  }

  serveFile(res, file) {
    if (!file) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    });
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (p === '/' ) { res.writeHead(302, { location: '/out/' }).end(); return; }
    // Pages poll this (?since=<version>); 204 = nothing changed. Polling instead of a held-open stream matters:
    // all OBS browser sources share one browser with a limit of 6 connections per host, and open streams
    // used up that limit so photos and other requests never loaded.
    if (p === '/api/state') {
      if (Number(url.searchParams.get('since')) === (this.version || 0) && this.version) { res.writeHead(204, { 'cache-control': 'no-store' }).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(this.json); return;
    }
    // No held-open streams on purpose (OBS shares 6 connections per host across all browser sources).
    if (p === '/events') { res.writeHead(410, { 'cache-control': 'no-store' }).end('gone: poll /api/state'); return; }
    if (p.startsWith('/photos/')) return this.serveFile(res, safeJoin(this.photoDir, p.slice(8)));
    if (p === '/out' || p === '/out/') return this.serveFile(res, path.join(this.outputsDir, 'index.html'));
    if (p.startsWith('/out/')) return this.serveFile(res, safeJoin(this.outputsDir, p.slice(5)));
    res.writeHead(404).end('not found');
  }
}

module.exports = { OutputServer };
