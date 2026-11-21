'use strict';
// "Read printout…" window (decisions D-17, D-24). Loaded after app.js and competitors.js and uses their helpers.
//
// On the event day DanS may not be reachable: the competition, its judges and who dances in a round arrive on
// paper. The operator holds the sheet in front of the webcam (or pastes / picks a photo, or the organizer sends one
// from the phone page). The main process reads the text and matches it against the offline copy and the gallery
// (printout.js); this window shows what was found, marks what is unsure, and lets the operator correct it before
// anything is applied. Applying fills the competitor screen and/or a judge panel; the screen changes only on Push.
//
// Left: live camera view, or the photo that was read. Right: the result as editable rows.

const scan = { stream: null, result: null, image: null, rows: null, bytes: null, rawUrl: null };
const ROTS = [0, 90, 180, 270];

// ---- which way up (C-42) ----
// A camera turned on its side fits a whole A4 page, but its picture lies on its side. The live view is shown turned
// by the remembered amount (S.printoutRotate); reading tries the other turns by itself if needed and remembers the
// one that worked. The Turn button sets it by hand.
function showTurn() {
  const v = $('#scan-video');
  v.classList.remove('rot90', 'rot180', 'rot270');
  if (S.printoutRotate) v.classList.add('rot' + S.printoutRotate);
}
$('#scan-turn').addEventListener('click', async () => {
  // a photo on show: read it again a quarter turn further (a camera frame also changes the camera's turn)
  if (scan.bytes) {
    const next = ROTS[(ROTS.indexOf(scan.turn || 0) + 1) % 4];
    if (scan.camera) { applyOr(await window.dp.printoutRotate(next)); S.printoutRotate = next; }
    readImage(scan.bytes, scan.rawUrl, { rotate: next, camera: scan.camera });
    return;
  }
  // live view: turn the picture of the camera
  const next = ROTS[(ROTS.indexOf(S.printoutRotate || 0) + 1) % 4];
  applyOr(await window.dp.printoutRotate(next));
  S.printoutRotate = next;
  showTurn();
});
// a picture turned deg degrees clockwise, for showing the photo the way it was read
function turnedUrl(url, deg) {
  if (!deg) return Promise.resolve(url);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const side = deg === 90 || deg === 270;
      const c = document.createElement('canvas');
      c.width = side ? img.naturalHeight : img.naturalWidth; c.height = side ? img.naturalWidth : img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2); ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}
const dlg = $('#scan-dlg');

function scanStatus(text, kind = '') { const el = $('#scan-status'); el.textContent = text; el.className = 'scan-status ' + kind; }

// ---- camera ----
function stopScanCam() { scan.stream?.getTracks().forEach((t) => t.stop()); scan.stream = null; }
async function startScanCam(deviceId) {
  stopScanCam();
  try {
    // as many pixels as the camera gives: small print needs them
    scan.stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
    $('#scan-video').srcObject = scan.stream;
  } catch (e) { scanStatus(`The camera could not be opened: ${e.message}`, 'err'); }
}
async function showLive() {
  scan.image = null; scan.bytes = null; scan.rawUrl = null;
  showTurn();
  $('#scan-img').hidden = true; $('#scan-video').hidden = false; $('#scan-shoot').hidden = false; $('#scan-live').hidden = true;
  await startScanCam(S.webcamId);
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const current = scan.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  const preferred = cams.find((d) => d.deviceId === S.webcamId) || cams.find((d) => /logitech/i.test(d.label)) || cams.find((d) => d.deviceId === current) || cams[0];
  $('#scan-device').replaceChildren(...cams.map((d, i) => h('option', { value: d.deviceId, selected: d === preferred }, d.label || `Camera ${i + 1}`)));
  if (preferred && preferred.deviceId !== current) await startScanCam(preferred.deviceId);
  if (!cams.length) scanStatus('No camera found. Paste a photo (Ctrl+V) or use From file…', 'err');
}
$('#scan-device').addEventListener('change', (e) => { startScanCam(e.target.value); window.dp.setWebcam(e.target.value); });

// ---- reading ----
// bytes: Uint8Array of a JPEG/PNG; url: something the <img> can show
// rotate: a turn chosen with the Turn button (otherwise the app finds the way up itself)
// camera: a frame of the live camera (starts at the camera's remembered turn); otherwise a photo, which starts upright
async function readImage(bytes, url, { rotate = null, camera = false } = {}) {
  stopScanCam();
  scan.image = url; scan.bytes = bytes; scan.rawUrl = url; scan.camera = camera;
  const shown = rotate ?? (camera ? S.printoutRotate || 0 : 0);
  scan.turn = shown;
  $('#scan-img').src = await turnedUrl(url, shown); $('#scan-img').hidden = false; $('#scan-video').hidden = true;
  $('#scan-shoot').hidden = true; $('#scan-live').hidden = false;
  scanStatus('Reading the printout… (a few seconds; the first read also starts the text recognition; a picture on its side takes longer the first time)');
  $('#scan-apply').disabled = true;
  const r = await window.dp.printoutRead(bytes, { rotate, camera });
  // the app may have found another way up: show the photo that way (and, for the camera, the live view from now on)
  if (r.result && r.result.rotate !== shown) $('#scan-img').src = await turnedUrl(url, r.result.rotate);
  if (r.result) { scan.turn = r.result.rotate; if (camera) { S.printoutRotate = r.result.rotate; showTurn(); } }
  showResult(r);
}
function showResult(r) {
  if (r.error) { scanStatus(r.error, 'err'); $('#scan-result').replaceChildren(); return; }
  scan.result = r.result;
  const unsure = r.result.competitors.filter((c) => !c.sure).length + r.result.judges.filter((j) => !j.sure).length;
  scanStatus(`Found ${r.result.competitors.length} competitor${r.result.competitors.length === 1 ? '' : 's'} and ${r.result.judges.length} judge${r.result.judges.length === 1 ? '' : 's'}`
    + (unsure ? ` · ${unsure} to check (marked)` : ' · everything matched clearly') + '. Check, then Apply.', unsure ? 'warn' : 'ok');
  renderScanResult();
}
// a frame of the live camera, as JPEG bytes (toDataURL: synchronous, never stalls)
function grabFrame() {
  const v = $('#scan-video');
  if (!scan.stream || !v.videoWidth) return null;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.95);
  return { url, bytes: Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (ch) => ch.charCodeAt(0)) };
}
$('#scan-shoot').addEventListener('click', () => { const f = grabFrame(); if (f) readImage(f.bytes, f.url, { camera: true }); });
$('#scan-live').addEventListener('click', showLive);
$('#scan-file').addEventListener('click', () => $('#scan-file-input').click());
$('#scan-file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) readImage(new Uint8Array(await f.arrayBuffer()), URL.createObjectURL(f));
});
// Ctrl+V while the window is open: a photo of the sheet (e.g. from WhatsApp Desktop)
document.addEventListener('paste', async (e) => {
  if (!dlg.open || ['INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const item = [...(e.clipboardData?.items || [])].find((x) => x.kind === 'file' && x.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  const f = item.getAsFile();
  readImage(new Uint8Array(await f.arrayBuffer()), URL.createObjectURL(f));
});
dlg.addEventListener('keydown', (e) => { if (e.code === 'Space' && !$('#scan-shoot').hidden && !['INPUT', 'SELECT'].includes(e.target.tagName)) { e.preventDefault(); $('#scan-shoot').click(); } });
dlg.addEventListener('close', stopScanCam);
$('#scan-close').addEventListener('click', () => dlg.close());

// ---- the result, as editable rows ----
// Competitor rows: number + who (all competitors of the event); judge rows: letter + who (event judges and the
// gallery). Unsure rows are marked; every row can be switched off, changed, or added.
const judgeChoices = () => S.gallery.filter((g) => g.inGallery || g.inEvent).map((g) => ({ fedId: g.fedId, label: g.displayName || judgeName(g) }));
function selectOf(options, value, placeholder) {
  return h('select', null, h('option', { value: '' }, placeholder), options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
}
function renderScanResult() {
  const r = scan.result;
  if (!r) return;
  const wrap = $('#scan-result');
  const compOptions = S.competitors.map((c) => ({ value: c.key, label: `${c.label || '(no name)'}${c.number ? ` · now ${c.number}` : ''}` }));
  const judgeOptions = judgeChoices().map((j) => ({ value: j.fedId, label: j.label }));

  // header: which competition and round
  const compSel = selectOf(S.competitions.map((c) => ({ value: c.id, label: `${c.number} · ${c.title}` })), r.header?.compId || '', r.header ? `Not matched – read: ${r.header.number ?? ''} ${r.header.title}` : 'Competition not read');
  compSel.id = 'scan-comp';
  const round = h('input', { id: 'scan-round', value: r.header?.round || '', placeholder: 'Round, e.g. Finále' });

  const mark = (sure, score) => h('span', { class: 'mark ' + (sure ? 'ok' : 'check'), title: `match ${Math.round(score * 100)} %` }, sure ? '✓' : 'check');
  const compRow = (c = {}) => {
    const row = h('div', { class: 'scan-row' + (c.sure === false ? ' unsure' : '') },
      h('input', { type: 'checkbox', checked: true, class: 'use', title: 'Use this row' }),
      h('input', { class: 'num', value: c.number || '', placeholder: 'no.', inputmode: 'numeric', maxlength: '4' }),
      selectOf(compOptions, c.key || '', '— choose competitor —'),
      c.score != null ? mark(c.sure, c.score) : h('span', { class: 'mark' }, 'added'));
    row.title = c.line ? `Read: ${c.line}` : '';
    return row;
  };
  const judgeRow = (j = {}) => h('div', { class: 'scan-row' + (j.sure === false ? ' unsure' : '') },
    h('input', { type: 'checkbox', checked: true, class: 'use', title: 'Use this row' }),
    h('input', { class: 'letter', value: j.letter || '', placeholder: '–', maxlength: '3' }),
    selectOf(judgeOptions, j.fedId || '', '— choose judge —'),
    j.score != null ? mark(j.sure, j.score) : h('span', { class: 'mark' }, 'added'));

  const comps = h('div', { class: 'scan-rows', id: 'scan-comps' }, r.competitors.map(compRow));
  const judges = h('div', { class: 'scan-rows', id: 'scan-judges' }, r.judges.map(judgeRow));
  const useC = h('input', { type: 'checkbox', id: 'scan-use-c', checked: r.competitors.length > 0 });
  const useJ = h('input', { type: 'checkbox', id: 'scan-use-j', checked: r.judges.length > 0 });
  const side = S.config.split ? h('select', { id: 'scan-side' }, ['A', 'B'].map((k) => h('option', { value: k }, `side ${k}`))) : null;

  wrap.replaceChildren(
    h('div', { class: 'scan-sec' }, h('b', null, 'Competition'), compSel, round),
    h('div', { class: 'scan-sec' },
      h('label', { class: 'row' }, useC, h('b', null, 'Competitors → competitor screen'), h('span', { class: 'sub' }, ' (round list, numbers)')),
      comps, h('button', { class: 'ghost small', onclick: () => comps.append(compRow()) }, '+ row')),
    h('div', { class: 'scan-sec' },
      h('label', { class: 'row' }, useJ, h('b', null, 'Judges → own selection'), side ? [' of ', side] : null),
      judges, h('button', { class: 'ghost small', onclick: () => judges.append(judgeRow()) }, '+ row')),
    h('details', null, h('summary', null, 'Recognised text'), h('pre', { class: 'scan-text' }, r.text || '')));
  $('#scan-apply').disabled = false;
}

$('#scan-apply').addEventListener('click', async () => {
  const rows = (id) => $$(`#${id} .scan-row`).filter((row) => $('.use', row).checked);
  const competitors = rows('scan-comps').map((row) => ({ number: $('.num', row).value.trim(), key: $('select', row).value })).filter((x) => x.key && x.number);
  const judges = rows('scan-judges').map((row) => ({ letter: $('.letter', row).value.trim(), fedId: $('select', row).value })).filter((x) => x.fedId);
  // the same number twice, or a competitor twice: fix first
  const dupN = competitors.map((c) => c.number).filter((n, i, a) => a.indexOf(n) !== i);
  const dupK = competitors.map((c) => c.key).filter((k, i, a) => a.indexOf(k) !== i);
  if (dupN.length || dupK.length) { scanStatus(dupN.length ? `Number ${dupN[0]} is used twice` : 'A competitor is in two rows', 'err'); return; }
  const compId = $('#scan-comp').value || null;
  const st = await window.dp.printoutApply({
    competitionId: compId,
    header: { number: scan.result.header?.number ?? null, title: compId ? '' : scan.result.header?.title || '', round: $('#scan-round').value.trim() },
    competitors, judges,
    useCompetitors: $('#scan-use-c').checked && competitors.length > 0,
    useJudges: $('#scan-use-j').checked && judges.length > 0,
    side: $('#scan-side')?.value || 'A',
  });
  applyOr(st);
  if (!st.error) { dlg.close(); toast('Printout applied. Check the previews, then push judges / competitors.'); }
});

// ---- opening ----
function openScan() {
  scan.result = null;
  $('#scan-result').replaceChildren(h('p', { class: 'hint' }, 'Hold the TOP of the sheet (title, competitors, Porota) in front of the camera so it fills most of the picture – flat, sharp, without glare – and press Read (or Space). A phone photo is sharper: paste it here (Ctrl+V) or send it from the phone page in Printout mode.'));
  $('#scan-apply').disabled = true;
  scanStatus('');
  dlg.showModal();
  showLive();
}
$('#scan-open').addEventListener('click', openScan);
// a printout photo sent from the phone page: show its reading straight away
window.dp.onPrintout((r) => {
  if (!dlg.open) { $('#scan-result').replaceChildren(); dlg.showModal(); }
  stopScanCam();
  $('#scan-img').src = r.image; $('#scan-img').hidden = false; $('#scan-video').hidden = true;
  $('#scan-shoot').hidden = true; $('#scan-live').hidden = false;
  showResult(r);
});
