'use strict';
// Text recognition for printouts (decision D-24, C-39): Tesseract (tesseract.js, WebAssembly) with the Czech
// language data that ships with the app (@tesseract.js-data/ces), so it works with no internet at the venue.
//
// One recognition runs at a time. The engine starts on first use (about a second) and is shut down after two quiet
// minutes, so it costs no memory while nobody reads printouts.
const path = require('path');
const { createWorker } = require('tesseract.js');

// The language file comes from node_modules; "best_int" is the accurate model (a few MB, a bit slower than "fast",
// still well under 2 s per photo).
const LANG_DIR = path.join(path.dirname(require.resolve('@tesseract.js-data/ces/package.json')), '4.0.0_best_int');

let worker = null, starting = null, idleTimer = null, queue = Promise.resolve();
let cacheDir = null;

// cachePath: where tesseract.js keeps the unpacked language file (the app data folder)
function setCacheDir(dir) { cacheDir = dir; }

async function getWorker() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stop, 120000);
  if (worker) return worker;
  if (!starting) {
    starting = createWorker('ces', 1, { langPath: LANG_DIR, cachePath: cacheDir || undefined, gzip: true })
      .then((w) => { worker = w; starting = null; return w; }, (e) => { starting = null; throw e; });
  }
  return starting;
}

async function stop() {
  clearTimeout(idleTimer);
  const w = worker; worker = null;
  if (w) try { await w.terminate(); } catch { /* already gone */ }
}

// Recognises the text in an image file. Returns { text, confidence }.
function recognize(file) {
  const run = async () => {
    const w = await getWorker();
    const { data } = await w.recognize(file);
    return { text: data.text || '', confidence: Math.round(data.confidence || 0) };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {}); // a failed read must not block the next one
  return p;
}

module.exports = { recognize, stop, setCacheDir };
