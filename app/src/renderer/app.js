'use strict';
// Operator window. Holds no data of its own: S is the latest state from the main process (rendererState() in
// main.js); every button calls window.dp.<something>() (preload.js) and redraws with the state it returns.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let S = null;
let filter = 'all', jfilter = 'all', search = '', jsearch = ''; // list filters of the Competitions and Judges tabs
const DONE = new Set(['Completed', 'Closed', 'Cancelled', 'Finished']);

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k.startsWith('--')) e.style.setProperty(k, v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
  return e;
}

const time = (ms) => ms ? new Date(ms).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '–';
// "14:02:11" today, "18. 11. 20:14" on another day
const stamp = (ms) => {
  if (!ms) return '–';
  const d = new Date(ms), t = d.toLocaleTimeString('cs-CZ');
  return d.toDateString() === new Date().toDateString() ? t : `${d.getDate()}. ${d.getMonth() + 1}. ${t.slice(0, -3)}`;
};
const ago = (ms) => { const s = Math.round((Date.now() - ms) / 1000); return s < 2 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };
const slotOf = (id) => Object.entries(S.config.slots).find(([, s]) => s.competitionId === id)?.[0] || null;

// Status dot and text in the top bar. What "good" means depends on the data mode:
//   automatic - recent successful read (green), older (orange), failing (red)
//   on demand - when the shown data was fetched; red only if the last fetch failed
//   manual    - never connects; shows how old the offline copy is
function renderStatus() {
  const st = S.status || {};
  const el = $('#status');
  const age = st.lastOk ? Math.round((Date.now() - st.lastOk) / 1000) : null;
  let text;
  if (S.mode === 'auto') {
    el.classList.toggle('ok', !!st.connected && age != null && age < 10);
    el.classList.toggle('stale', !!st.connected && age != null && age >= 10);
    text = st.connected ? (age != null ? `Updated ${ago(st.lastOk)}` : 'Connected') : (st.error ? `No connection: ${st.error}` : 'Not connected');
  } else {
    el.classList.toggle('ok', S.mode === 'ondemand' && !st.error && !!S.dataTime);
    el.classList.toggle('stale', S.mode === 'manual' || (!st.error && !S.dataTime));
    const data = S.dataTime ? `data from ${stamp(S.dataTime)} (${ago(S.dataTime)})` : 'no data read yet';
    text = S.mode === 'manual' ? `Offline · ${data}` : st.error ? `Fetch failed: ${st.error}` : `On demand · ${data}`;
  }
  if (!S.config.eventId && !S.fixture) text = st.error ? text : 'Choose an event';
  $('#status-text').textContent = text;
  const badge = $('#fixture-badge');
  if (S.fixture && !badge) el.prepend(h('span', { class: 'badge', id: 'fixture-badge' }, 'Snapshot'));
}

// same rule as the main process: add http://, drop trailing slashes
const normServer = (u) => { u = String(u || '').trim().replace(/\/+$/, ''); return u && !/^https?:\/\//i.test(u) ? 'http://' + u : u; };
const savedServer = (url) => (S.config.servers || []).find((s) => s.url === normServer(url)) || null;

function renderServers() {
  const list = S.config.servers || [];
  const cur = savedServer(S.config.server);
  const pick = $('#server-pick');
  pick.hidden = !list.length;
  pick.replaceChildren(...(cur ? [] : [h('option', { value: '' }, 'Other address')]),
    ...list.map((s) => h('option', { value: s.url, selected: s === cur, title: s.url }, s.name)));
  $('#server-save').textContent = savedServer($('#server').value) ? 'Edit…' : 'Save…';
}

let shownServer = null; // keep a typed, not yet connected address until the server really changes
function renderBar() {
  if (S.config.server !== shownServer && document.activeElement !== $('#server')) { $('#server').value = S.config.server; shownServer = S.config.server; }
  renderServers();
  $('#server-form').hidden = !!S.fixture;
  $('#refresh-events').hidden = !!S.fixture;
  const sel = $('#event');
  const current = S.fixture ? S.event?.id : S.config.eventId;
  sel.replaceChildren(h('option', { value: '' }, S.events.length ? 'Choose an event…' : S.mode === 'manual' ? 'No offline copies yet' : 'No events found'),
    ...S.events.map((e) => h('option', { value: e.id, selected: e.id === current }, `${e.date || ''}  ${e.abbreviation || ''}  ${e.name}${e.offline ? '  (offline copy)' : ''}`)));
  sel.disabled = !!S.fixture;
  $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  $('#modes').hidden = !!S.fixture;
  if (!fetching) {
    $('#fetch-now').hidden = S.mode !== 'ondemand' || !!S.fixture;
    $('#fetch-now').disabled = !S.config.eventId;
  }
  $('#server-form').classList.toggle('dim', S.mode === 'manual'); // still editable, just not used in manual mode
  renderStatus();
}

function compRow(c) {
  const slot = slotOf(c.id);
  const done = DONE.has(c.state);
  const r = c.round;
  return h('tr', { class: [c.running && 'running', done && 'done'].filter(Boolean).join(' ') },
    h('td', null, h('div', { class: 'slotbtns' }, (S.config.split ? ['A', 'B'] : ['A']).map((k) => h('button', {
      class: 'slotbtn' + (slot === k ? ' on' : '') + (S.config.split ? '' : ' wide'), '--c': S.config.split ? S.config.slots[k].color : S.theme.accent,
      title: slot === k ? 'Take off the screen' : S.config.split ? `Show on slot ${k} (${S.config.slots[k].label})` : 'Show on screen',
      onclick: () => window.dp.assign(k, c.id).then(apply),
    }, S.config.split ? k : (slot === k ? 'On screen' : 'Show'))))),
    h('td', { class: 'n' }, c.number),
    h('td', null, h('div', { class: 't' }, c.title, c.running ? h('span', { class: 'run-tag' }, 'Running') : null), h('div', { class: 'sub' }, c.titleShort + ' · ' + c.state)),
    h('td', null, time(c.checkInEnd)),
    h('td', null, r ? [h('div', null, r.name), h('div', { class: 'sub' }, `${r.state}${r.competes ? ` · ${r.competes}${r.advances ? ' → ' + r.advances : ''}` : ''}`)] : h('span', { class: 'sub' }, 'No round')),
    h('td', null, r ? r.dances.map((d, i) => h('span', { class: 'dance' + (d.completed ? ' done' : '') + (i === r.currentDance && !d.completed ? ' now' : ''), title: d.name }, d.abbr)) : null),
    h('td', { class: 'num' }, `${c.checkedIn ?? 0} / ${c.registered ?? 0}`),
    h('td', { class: 'num' }, c.judgeCount || '–'));
}

function renderComps() {
  let list = S.competitions.slice();
  if (filter === 'running') list = list.filter((c) => c.running);
  if (filter === 'open') list = list.filter((c) => !DONE.has(c.state));
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((c) => String(c.number) === q || c.title.toLowerCase().includes(q) || c.titleShort.toLowerCase().includes(q));
  }
  list.sort((a, b) => (b.running - a.running) || (a.number - b.number));
  $('#comps').replaceChildren(...list.map(compRow));
  const empty = $('#comps-empty');
  empty.hidden = list.length > 0;
  empty.textContent = !S.competitions.length
    ? (S.config.eventId || S.fixture ? 'Loading competitions…' : 'Choose an event to see its competitions.')
    : filter === 'running' ? 'No competition is running. A competition counts as running once judging is enabled for its round.' : 'Nothing matches the filter.';
}

function renderSlots() {
  const wrap = $('#slots');
  if (!wrap.children.length) {
    for (const k of ['A', 'B']) {
      const el = $('#slot-tpl').content.firstElementChild.cloneNode(true);
      el.dataset.slot = k;
      $('.slot-key', el).textContent = k;
      $('.slot-label', el).addEventListener('change', (e) => window.dp.setSlot(k, { label: e.target.value }).then(apply));
      $('.slot-label-en', el).addEventListener('change', (e) => window.dp.setSlot(k, { labelEn: e.target.value }).then(apply));
      $('.slot-color', el).addEventListener('input', (e) => { el.style.setProperty('--c', e.target.value); });
      $('.slot-color', el).addEventListener('change', (e) => window.dp.setSlot(k, { color: e.target.value }).then(apply));
      $('.slot-follow', el).addEventListener('change', (e) => window.dp.setSlot(k, { follow: e.target.checked }).then(apply));
      wrap.append(el);
    }
  }
  const split = !!S.config.split;
  $('#split').checked = split;
  for (const el of $$('.slot', wrap)) {
    const k = el.dataset.slot, s = S.config.slots[k];
    el.hidden = !split && k === 'B';
    el.classList.toggle('single', !split);
    el.style.setProperty('--c', split ? s.color : S.theme.accent); // whole floor uses the style's accent
    if (document.activeElement !== $('.slot-label', el)) $('.slot-label', el).value = s.label;
    if (document.activeElement !== $('.slot-label-en', el)) $('.slot-label-en', el).value = s.labelEn || '';
    if (document.activeElement !== $('.slot-color', el)) $('.slot-color', el).value = s.color;
    $('.slot-follow', el).checked = !!s.follow;
    const c = S.competitions.find((x) => x.id === s.competitionId);
    const box = $('.slot-comp', el);
    if (!c) { box.replaceChildren(h('div', { class: 'none' }, s.competitionId ? 'Competition not in this event' : split ? 'Nothing assigned. Use the A/B buttons in the list.' : 'Nothing on screen. Press Show in the list.')); continue; }
    const r = c.round, d = r?.dances?.[r.currentDance];
    box.replaceChildren(
      h('button', { class: 'clear', onclick: () => window.dp.assign(k, c.id).then(apply) }, 'Clear'),
      h('div', { class: 't' }, `${c.number} · ${c.title}`),
      h('div', { class: 'sub' }, r ? `${r.name} · ${r.state}${d ? ' · now ' + d.name : ''}${c.running ? ' · running' : ''}` : 'No round yet'));
  }
}

function renderOutputs() {
  const o = S.outputs;
  const list = $('#outputs');
  if (!o) { list.replaceChildren(h('li', null, h('div', { class: 'url' }, 'Output server is not running.'))); return; }
  const sel = $('#host');
  const prev = sel.value || 'localhost';
  sel.replaceChildren(...o.hosts.map((x) => h('option', { value: x, selected: x === prev }, x === 'localhost' ? 'This computer (localhost)' : `Network: ${x}`)));
  const host = sel.value || 'localhost';
  list.replaceChildren(...o.pages.map((p) => {
    const url = `http://${host}:${p.port || o.port}${p.path}`;
    return h('li', null,
      h('div', null, h('div', { class: 'name' }, p.name), h('div', { class: 'url' }, url)),
      h('button', { onclick: (e) => { navigator.clipboard.writeText(url); e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy'), 1200); } }, 'Copy'),
      h('button', { onclick: () => window.dp.openUrl(url + (url.includes('?') ? '&' : '?') + 'bg=1') }, 'Preview'));
  }));
}

function cropImg(url, c) {
  c = c || { x: 50, y: 30, zoom: 1 };
  const img = h('img', { src: url, alt: '' });
  Object.assign(img.style, { objectPosition: `${c.x}% ${c.y}%`, transformOrigin: `${c.x}% ${c.y}%`, transform: `scale(${c.zoom})` });
  return img;
}

// ---- crop editor ----
// Edits the framing of one photo of one judge. crop.c = { x, y } focus point in percent and zoom 1–4.
// It is saved for that photo only, so each photo of a judge keeps its own framing.
// The same dialog serves competitor photos (competitors.js openCompCrop): then kind is 'comp' and fedId holds
// the competitor's key.
const crop = { kind: 'judge', fedId: null, file: null, c: null };
function showCrop() {
  const img = $('#crop-img'), c = crop.c;
  Object.assign(img.style, { objectPosition: `${c.x}% ${c.y}%`, transformOrigin: `${c.x}% ${c.y}%`, transform: `scale(${c.zoom})` });
  $('#crop-zoom').value = c.zoom;
}
// g = gallery row (galleryView in main.js), p = one of its photos
function openCrop(g, p) {
  crop.kind = 'judge';
  $('#crop-frame').classList.remove('sq'); // judge cards are 3:4
  crop.fedId = g.fedId;
  crop.file = p.file;
  crop.c = { ...(p.crop || { x: 50, y: 30, zoom: 1 }) };
  $('#crop-title').textContent = `Adjust photo – ${judgeName(g)}`;
  $('#crop-letter').textContent = g.letter || '';
  $('#crop-img').src = p.url;
  showCrop();
  $('#crop').showModal();
}
(() => {
  const frame = $('#crop-frame');
  let drag = null;
  frame.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, c: { ...crop.c } }; frame.setPointerCapture(e.pointerId); });
  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 100 / crop.c.zoom; // moving the image right shows more of its left part
    crop.c.x = Math.min(100, Math.max(0, drag.c.x - ((e.clientX - drag.x) / frame.clientWidth) * k));
    crop.c.y = Math.min(100, Math.max(0, drag.c.y - ((e.clientY - drag.y) / frame.clientHeight) * k));
    showCrop();
  });
  frame.addEventListener('pointerup', () => { drag = null; });
  frame.addEventListener('wheel', (e) => { e.preventDefault(); crop.c.zoom = Math.min(4, Math.max(1, crop.c.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06))); showCrop(); }, { passive: false });
  $('#crop-zoom').addEventListener('input', (e) => { crop.c.zoom = +e.target.value; showCrop(); });
  $('#crop-reset').addEventListener('click', () => { crop.c = { x: 50, y: 30, zoom: 1 }; showCrop(); });
  // Rotate: the main process writes a turned copy and returns its file name; the dialog switches to it.
  const rotate = async (degrees) => {
    for (const b of [$('#crop-rot-left'), $('#crop-rot-right')]) b.disabled = true; // one turn at a time
    try {
      const comp = crop.kind === 'comp';
      const { state, file } = await (comp ? window.dp.compPhotoRotate : window.dp.judgePhotoRotate)(crop.fedId, crop.file, degrees);
      apply(state);
      const owner = comp ? state.competitors.find((c) => c.key === crop.fedId) : state.gallery.find((g) => g.fedId === crop.fedId);
      const p = file && owner?.photos.find((x) => x.file === file);
      if (p) { crop.file = p.file; crop.c = { x: 50, y: 30, zoom: 1 }; $('#crop-img').src = p.url; showCrop(); }
    } finally { for (const b of [$('#crop-rot-left'), $('#crop-rot-right')]) b.disabled = false; }
  };
  $('#crop-rot-left').addEventListener('click', () => rotate(-90));
  $('#crop-rot-right').addEventListener('click', () => rotate(90));
  // Saved from the form's submit, which fires at once (the dialog "close" event can arrive late).
  $('#crop form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save' || !crop.fedId) return;
    (crop.kind === 'comp' ? window.dp.compCrop : window.dp.judgeCrop)(crop.fedId, crop.c, crop.file).then(apply);
  });
})();

// ---- Judges tab: the gallery ----
// One card per judge: everyone in the gallery plus the judges of the current event. The big photo is the main
// portrait shown on screen. The strip below holds every photo: click a thumbnail to make it the main one,
// × deletes it (it turns into "Delete?" first, so a stray click does not lose a photo), + adds photos.
// Files can be dropped on the big photo (added as the new main photo) or on the strip (extra photos).
const judgeName = (g) => `${g.name || g.dansName} ${g.surname || g.dansSurname}`.trim() || `IDT ${g.fedId}`;
let armedDelete = null; // "fedId/file" of the thumbnail waiting for the confirming second click

function dropZone(el, onFiles) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drag'); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
}

function judgeCard(g) {
  const main = g.photos.find((p) => p.file === g.main) || null;
  const ph = h('div', { class: 'ph' + (main ? ' has' : ''), title: main ? 'Click to adjust the framing. Drop an image here to add it as the main photo.' : 'Click to choose photos, or drop images here' },
    main ? cropImg(main.url, main.crop) : 'Add photo');
  ph.addEventListener('click', () => (main ? openCrop(g, main) : window.dp.judgePhotosAdd(g.fedId).then(apply)));
  dropZone(ph, (files) => window.dp.judgePhotosAdd(g.fedId, files, true).then(apply));

  // Editable names. Placeholders show the DanS names, so an empty field still says what will be used.
  const field = (key, label, placeholder, title) => {
    const input = h('input', { value: g[key], placeholder, title });
    input.addEventListener('change', () => window.dp.judgeUpdate(g.fedId, { [key]: input.value }).then(apply));
    return h('label', { class: 'stack' }, h('small', null, label), input);
  };
  // Point out when the gallery spelling differs from DanS (the gallery wins on screen)
  const dansDiffers = g.inEvent && (g.name || g.surname) && `${g.name} ${g.surname}` !== `${g.dansName} ${g.dansSurname}`;

  const thumbs = g.photos.map((p) => {
    const key = `${g.fedId}/${p.file}`;
    const armed = armedDelete === key;
    return h('div', { class: 'thumb' + (p.file === g.main ? ' main' : '') },
      h('button', { class: 'thumb-img', title: p.file === g.main ? 'Main photo (shown on screen)' : 'Make this the main photo',
        onclick: () => window.dp.judgePhotoMain(g.fedId, p.file).then(apply) }, cropImg(p.url, p.crop)),
      h('button', { class: 'thumb-del' + (armed ? ' armed' : ''), title: armed ? 'Click again to delete this photo' : 'Delete this photo',
        onclick: (e) => {
          const btn = e.currentTarget;
          // Arm/disarm by changing this button in place (no redraw), so the second click hits the same button
          const setArmed = (on) => { btn.classList.toggle('armed', on); btn.textContent = on ? 'Delete?' : '×'; btn.title = on ? 'Click again to delete this photo' : 'Delete this photo'; };
          if (armedDelete !== key) {
            armedDelete = key; setArmed(true);
            setTimeout(() => { if (armedDelete === key) { armedDelete = null; setArmed(false); } }, 3000); // disarm after 3 s
            return;
          }
          armedDelete = null; window.dp.judgePhotoDelete(g.fedId, p.file).then(apply);
        } }, armed ? 'Delete?' : '×'));
  });
  const add = h('button', { class: 'thumb-add', title: 'Add photos (or drop them here)', onclick: () => window.dp.judgePhotosAdd(g.fedId).then(apply) }, '+');
  const strip = h('div', { class: 'strip' }, thumbs, add);
  dropZone(strip, (files) => window.dp.judgePhotosAdd(g.fedId, files).then(apply));

  return h('div', { class: 'judge' + (g.inSlots ? ' on' : '') },
    ph,
    h('div', { class: 'jinfo' },
      h('div', { class: 'jtop' },
        g.letter ? h('span', { class: 'jletter', title: 'Judge letter at this event' }, g.letter) : null,
        h('span', { class: 'jname' }, judgeName(g))),
      h('div', { class: 'jfed' }, `IDT ${g.fedId}`,
        g.inEvent ? h('span', { class: 'tag ev' }, 'In this event') : null,
        g.inGallery ? null : h('span', { class: 'tag new' }, 'Not in gallery yet'),
        g.photos.length > 1 ? h('span', { class: 'tag' }, `${g.photos.length} photos`) : null),
      h('div', { class: 'names' },
        field('name', 'Name', g.dansName, 'First name. Saved in the gallery and used at every event.'),
        field('surname', 'Surname', g.dansSurname, 'Surname. Saved in the gallery and used at every event.')),
      dansDiffers ? h('div', { class: 'jfed' }, `DanS has: ${g.dansName} ${g.dansSurname}`) : null,
      field('displayName', 'Name on screen (optional)', `${g.name || g.dansName} ${g.surname || g.dansSurname}`.trim(),
        'Replaces "Name Surname" on the projection, for example with a title. Leave empty to use the name and surname.'),
      strip,
      g.inGallery ? h('div', { class: 'jactions end' },
        h('button', { class: 'ghost danger', onclick: () => confirmDeleteJudge(g) }, 'Delete judge…')) : null));
}

// Asks before deleting a judge from the gallery, and says exactly what goes with them.
let deletingJudge = null;
function confirmDeleteJudge(g) {
  deletingJudge = g.fedId;
  const inOwn = ['A', 'B'].filter((k) => (S.config.manualPanels?.[k]?.judges || []).some((j) => j.fedId === g.fedId));
  $('#jd-text').textContent = `${judgeName(g)} (IDT ${g.fedId}) will be removed from the gallery:`;
  $('#jd-list').replaceChildren(...[
    h('li', null, g.photos.length ? `${g.photos.length} photo${g.photos.length === 1 ? '' : 's'}, with their framing` : 'no photos'),
    h('li', null, 'the name, surname and name on screen kept here'),
    inOwn.length ? h('li', null, `the judge's place in the own selection${inOwn.length > 1 ? 's' : ''} (${inOwn.join(', ')})`) : null,
    g.inEvent ? h('li', { class: 'sub' }, 'The judge stays listed from the DanS event, without photos.') : null,
    h('li', { class: 'sub' }, 'This cannot be undone; the photos can be imported again from their files.'),
  ].filter(Boolean)); // replaceChildren would print "null" for the skipped lines
  $('#judge-del-dlg').showModal();
}
// Saved from the form's submit (fires at once), like the other dialogs
$('#judge-del-dlg form').addEventListener('submit', (e) => {
  if (e.submitter?.value === 'delete' && deletingJudge) window.dp.judgeDelete(deletingJudge).then(apply);
  deletingJudge = null;
});

function renderJudges() {
  let list = S.gallery;
  if (jfilter === 'event') list = list.filter((g) => g.inEvent);
  if (jfilter === 'slots') list = list.filter((g) => g.inSlots);
  if (jfilter === 'nophoto') list = list.filter((g) => !g.photos.length);
  if (jsearch) {
    const q = jsearch.toLowerCase();
    list = list.filter((g) => g.fedId.includes(q) || [g.name, g.surname, g.displayName, g.dansName, g.dansSurname].join(' ').toLowerCase().includes(q));
  }
  const wrap = $('#judges');
  if (wrap.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // don't steal focus while typing
  wrap.replaceChildren(...list.map(judgeCard));
  $('#jcount').textContent = `${S.gallery.filter((g) => g.inGallery).length} in the gallery`;
  const empty = $('#judges-empty');
  empty.hidden = list.length > 0;
  if (!list.length) empty.textContent = !S.gallery.length ? 'The gallery is empty. Use Import folder… or New judge…, or choose an event to see its judges.' : 'No judge matches the filter.';
}

// Result of Import folder…, shown above the gallery until dismissed.
function showImportReport(r) {
  if (!r) return;
  const el = $('#import-report');
  el.hidden = false;
  el.replaceChildren(
    h('b', null, `Imported ${r.added} photo${r.added === 1 ? '' : 's'} for ${r.judges} judge${r.judges === 1 ? '' : 's'}.`),
    r.redone ? ` ${r.redone} imported earlier were redone from the originals (fixes rotated photos).` : '',
    r.duplicates ? ` ${r.duplicates} already in the gallery, skipped.` : '',
    r.unrecognised.length ? h('div', null, `Not named "IDT_Surname_Name": ${r.unrecognised.join(', ')}`) : '',
    r.failed.length ? h('div', { class: 'err' }, `Could not read: ${r.failed.join('; ')}`) : '',
    h('button', { class: 'ghost', onclick: () => { el.hidden = true; } }, 'OK'));
}

function renderSettings() {
  $('#lang-primary').value = S.config.language.primary;
  $('#lang-secondary').value = S.config.language.secondary;
  if (document.activeElement !== $('#running-states')) $('#running-states').value = S.config.runningStates.join(', ');
}

// ---- Judge selection tab ----
// One block per screen side (A, and B when the floor is split). Each side shows one of two sources:
//   From DanS     – the panel of a DanS competition, chosen here or in Competitions (DanS allocation, editable)
//   Own selection – judges picked from the gallery with letters set here; needs no DanS data at all (D-19)
const PANEL_SOURCE = {
  dans: 'Panel from DanS',
  manual: 'Picked by hand',
  none: 'No panel yet',
};
const psearch = { A: '', B: '' }; // search text of each side's gallery picker

// ---- order of the judge cards on screen (panels.js sortJudges in the main process) ----
const SORT_LABELS = { surname: 'Surname', firstname: 'First name', letter: 'Letter (DanS order)', custom: 'Custom' };
// "Order on screen" chips of one side
function sortChips(k) {
  const cur = S.config.slots[k].judgeSort || 'surname';
  return h('div', { class: 'order-head' }, h('b', null, 'Order on screen'),
    h('div', { class: 'chips' }, Object.entries(SORT_LABELS).map(([mode, label]) => h('button', {
      class: 'chip' + (cur === mode ? ' active' : ''),
      title: mode === 'custom' ? 'Arrange the judges yourself with the arrows' : `Sort the judge cards by ${label.toLowerCase()}`,
      onclick: () => window.dp.setJudgeSort(k, mode).then(apply),
    }, label))));
}
// Up / down buttons of the judge at position i of n; pressing one switches the side to the custom order
function moveButtons(k, fedId, i, n) {
  return h('span', { class: 'mv' },
    h('button', { class: 'ghost', disabled: i === 0 ? '' : null, title: 'Move one place earlier', onclick: () => window.dp.judgeMove(k, fedId, -1).then(apply) }, '\u2191'),
    h('button', { class: 'ghost', disabled: i === n - 1 ? '' : null, title: 'Move one place later', onclick: () => window.dp.judgeMove(k, fedId, 1).then(apply) }, '\u2193'));
}
// The panel of a DanS side as the screen will show it, with the arrows
function orderList(k) {
  const list = S.screenOrder?.[k] || [];
  if (!list.length) return null;
  return h('ol', { class: 'order-list' }, list.map((j, i) => h('li', { class: 'own-row order-row' },
    h('span', { class: 'pos' }, i + 1),
    h('span', { class: 'pj-ph' }, j.photo ? cropImg(j.photo, j.crop) : null),
    h('span', { class: 'pj-name' }, j.name, j.letter ? h('small', null, ` \u00b7 ${j.letter}`) : null),
    moveButtons(k, j.fedId, i, list.length))));
}

function renderPanels() {
  const wrap = $('#panels');
  // don't redraw under the cursor while a field (letter, title, search) is being typed in
  if (wrap.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const keys = S.config.split ? ['A', 'B'] : ['A'];
  wrap.replaceChildren(...keys.map((k) => {
    const slot = S.config.slots[k];
    const color = S.config.split ? slot.color : S.theme.accent;
    const own = slot.source === 'manual';
    const sources = h('div', { class: 'chips' },
      h('button', { class: 'chip' + (own ? '' : ' active'), onclick: () => window.dp.setSlotSource(k, 'dans').then(apply) }, 'From DanS'),
      h('button', { class: 'chip' + (own ? ' active' : ''), onclick: () => window.dp.setSlotSource(k, 'manual').then(apply),
        title: 'Pick judges from the gallery. Works without DanS.' }, 'Own selection'));
    const body = own ? manualBlock(k) : dansBlock(k, slot);
    return h('section', { class: 'pnl', '--c': color },
      h('div', { class: 'pnl-head' }, h('span', { class: 'slot-key' }, S.config.split ? k : ''), sources, body.title),
      ...body.parts);
  }));
}

// Own selection of one side: optional competition details, the chosen judges with editable letters, and the
// gallery as toggle buttons.
function manualBlock(k) {
  const m = S.config.manualPanels?.[k] || { judges: [] };
  const byId = new Map(S.gallery.map((g) => [g.fedId, g]));
  const chosen = (m.judges || []).filter((j) => byId.get(j.fedId)?.inGallery);
  const field = (key, label, placeholder, cls = '') => {
    const input = h('input', { value: m[key] || '', placeholder, class: cls });
    input.addEventListener('change', () => window.dp.manualUpdate(k, { [key]: input.value }).then(apply));
    return h('label', { class: 'stack' }, h('small', null, label), input);
  };
  const details = h('div', { class: 'own-details' },
    field('number', 'No.', '–', 'num'),
    field('title', 'Competition (main language)', 'optional, e.g. Mistrovství ČR Senioři STT'),
    field('titleEn', 'Competition (second language)', 'optional'),
    field('round', 'Round', 'optional, e.g. Finále'));

  // chosen judges in the order the screen shows them; the arrows rearrange them, and the letter can be changed
  // (Enter or leaving the field saves it). Letters are no longer shown on screen but still drive "Letter" order.
  const pos = new Map((S.screenOrder?.[k] || []).map((j, i) => [j.fedId, i]));
  const rows = chosen.slice().sort((a, b) => (pos.get(a.fedId) ?? 999) - (pos.get(b.fedId) ?? 999)).map((j, i, all) => {
    const g = byId.get(j.fedId);
    const main = g.photos.find((p) => p.file === g.main);
    const letter = h('input', { class: 'own-letter', value: j.letter, maxlength: '3', title: 'Judge letter shown on screen' });
    letter.addEventListener('change', () => window.dp.manualLetter(k, j.fedId, letter.value).then(apply));
    return h('div', { class: 'own-row' },
      h('span', { class: 'pj-ph' }, main ? cropImg(main.url, main.crop) : null),
      letter,
      h('span', { class: 'pj-name' }, g.displayName || judgeName(g)),
      moveButtons(k, j.fedId, i, all.length),
      h('button', { class: 'ghost', title: 'Remove from the selection', onclick: () => window.dp.manualToggle(k, j.fedId).then(apply) }, '×'));
  });
  const letters = chosen.map((j) => j.letter);
  const dup = letters.filter((l, i) => letters.indexOf(l) !== i);

  // the gallery as a picker; the search box filters the buttons in place (no redraw while typing)
  const inSel = new Set(chosen.map((j) => j.fedId));
  const gallery = S.gallery.filter((g) => g.inGallery);
  const buttons = gallery.map((g) => {
    const main = g.photos.find((p) => p.file === g.main);
    return h('button', {
      class: 'pick-j' + (inSel.has(g.fedId) ? ' on' : ''), 'data-q': `${g.fedId} ${judgeName(g)} ${g.displayName}`.toLowerCase(),
      title: inSel.has(g.fedId) ? 'Remove from the selection' : 'Add to the selection',
      onclick: () => window.dp.manualToggle(k, g.fedId).then(apply),
    }, h('span', { class: 'pj-ph' }, main ? cropImg(main.url, main.crop) : null),
    h('span', { class: 'jletter' }, chosen.find((j) => j.fedId === g.fedId)?.letter || '+'),
    h('span', { class: 'pj-name' }, g.displayName || judgeName(g)));
  });
  const filter = () => { const q = psearch[k].toLowerCase(); for (const b of buttons) b.hidden = !!q && !b.dataset.q.includes(q); };
  const search = h('input', { class: 'own-search', placeholder: 'Find IDT or name', value: psearch[k] });
  search.addEventListener('input', () => { psearch[k] = search.value.trim(); filter(); });
  filter();

  return {
    title: h('div', { class: 'pnl-title' }, h('span', { class: 'sub' }, 'Judges from the gallery. Works without DanS.')),
    parts: [
      details,
      h('div', { class: 'pnl-tools' },
        h('span', { class: 'src manual' }, `${chosen.length} selected`),
        dup.length ? h('span', { class: 'err' }, `Letter ${[...new Set(dup)].join(', ')} is used twice`) : null,
        h('span', { class: 'count' }),
        chosen.length ? h('button', { class: 'ghost', onclick: () => window.dp.manualClear(k).then(apply) }, 'Clear') : null),
      sortChips(k),
      rows.length ? h('div', { class: 'own-rows' }, rows) : h('p', { class: 'hint' }, 'Click judges below to add them. Letters are given A, B, C… and can be changed.'),
      gallery.length
        ? [h('div', { class: 'own-pick-head' }, h('b', null, 'Gallery'), search), h('div', { class: 'pick' }, buttons)]
        : h('p', { class: 'empty' }, 'The gallery is empty. Add judges in the Judges tab (Import folder… or New judge…).'),
    ].flat(),
  };
}

// Panel of the DanS competition shown on this side (from the allocation, editable).
// The side picks its competition right here (dansSource: Fetch from DanS + competition list), so the operator
// doesn't have to go to the Competitions tab; choosing one does the same as its Show / A / B buttons.
function dansBlock(k, slot) {
  const c = S.competitions.find((x) => x.id === slot.competitionId);
  const title = c
    ? h('div', { class: 'pnl-title' }, h('b', null, `${c.number} · ${c.title}`), h('div', { class: 'sub' }, c.round ? `${c.round.name} · ${c.round.state}` : 'No round yet'))
    : h('div', { class: 'pnl-title' }, h('span', { class: 'sub' }, S.competitions.length
      ? 'Choose the competition below.'
      : 'No DanS data yet. Fetch it below, or use Own selection to pick judges from the gallery.'));
  const source = dansSource(k, slot);
  if (!c) return { title, parts: [source] };
  // DanS panel: tools, the order on screen (with arrows), then every judge of the event to add or remove
  const [tools, grid] = dansParts(c);
  return { title, parts: [source, tools, sortChips(k), orderList(k), h('div', { class: 'own-pick-head' }, h('b', null, 'Judges of the event')), grid].filter(Boolean) };
}

// Where a DanS side gets its panel: a fetch button (what it does depends on the data mode) and the list of the
// event's competitions. The judge count in each entry shows which competitions already have a panel drawn.
function dansSource(k, slot) {
  let fetchPart;
  if (S.fixture) fetchPart = h('span', { class: 'sub' }, 'Snapshot data');
  else if (!S.config.eventId) fetchPart = h('span', { class: 'sub' }, 'Choose the DanS event in the top bar first.');
  else if (S.mode === 'manual') {
    // Manual mode promises never to contact DanS, so fetching here needs a deliberate switch first
    fetchPart = [h('span', { class: 'sub' }, `Manual mode: offline copy${S.dataTime ? ` from ${stamp(S.dataTime)}` : ' (none yet)'}.`),
      h('button', { title: 'Switch the data mode to On demand, then press Fetch from DanS', onclick: () => window.dp.setMode('ondemand').then(apply) }, 'Switch to On demand')];
  } else if (S.mode === 'auto') fetchPart = h('span', { class: 'sub' }, 'Automatic mode: DanS is read every 2 seconds.');
  else {
    fetchPart = [h('button', {
      class: 'primary', disabled: fetching ? '' : null,
      title: 'Read competitions, judges and the judge allocation from DanS now (3 requests)',
      onclick: (e) => fetchNow(e.currentTarget),
    }, fetching ? 'Fetching…' : 'Fetch from DanS'),
    h('span', { class: 'sub' }, S.status?.error ? `Fetch failed: ${S.status.error}` : S.dataTime ? `Data from ${stamp(S.dataTime)}` : 'Nothing fetched yet')];
  }

  // competitions of the event; the one on the other side is marked, picking it moves it to this side
  const other = S.config.split ? S.config.slots[k === 'A' ? 'B' : 'A'].competitionId : null;
  const pick = h('select', { class: 'comp-pick', disabled: S.competitions.length ? null : '' },
    h('option', { value: '' }, S.competitions.length ? '– choose a competition –' : 'no competitions in the data'),
    S.competitions.slice().sort((a, b) => a.number - b.number).map((c) => h('option', { value: c.id, selected: c.id === slot.competitionId },
      `${c.number} · ${c.title}${c.round ? ` · ${c.round.name}` : ''} · ${c.judgeCount ? `${c.judgeCount} judges` : 'no panel yet'}${c.id === other ? ' (on side ' + (k === 'A' ? 'B' : 'A') + ')' : ''}`)));
  pick.addEventListener('change', () => {
    // assign() toggles: the same id again takes the competition off this side, which is what "–" means
    const id = pick.value || slot.competitionId;
    if (id) window.dp.assign(k, id).then(apply);
  });
  return h('div', { class: 'pnl-tools dans-source' }, fetchPart, h('span', { class: 'spacer' }), h('label', { class: 'comp-pick-l' }, h('b', null, 'Competition '), pick));
}

function dansParts(c) {
  const chosen = new Set(c.judgeIds);
  const dans = new Set(c.dansJudgeIds);
  // Differences to DanS, so a hand-picked panel that disagrees with the draw is easy to spot
  const added = c.panelSource === 'manual' ? c.judgeIds.filter((id) => !dans.has(id)).length : 0;
  const removed = c.panelSource === 'manual' ? c.dansJudgeIds.filter((id) => !chosen.has(id)).length : 0;
  const diff = c.panelSource === 'manual' && c.dansJudgeIds.length
    ? (added || removed ? ` · differs from DanS (+${added} / −${removed})` : ' · same as DanS') : '';
  const tools = h('div', { class: 'pnl-tools' },
    h('span', { class: 'src ' + c.panelSource }, PANEL_SOURCE[c.panelSource] + diff),
    h('span', { class: 'count' }, `${c.judgeIds.length} selected`),
    c.panelSource === 'manual' ? h('button', { onclick: () => window.dp.panelReset(c.id).then(apply), title: 'Forget your choice and use the allocation read from DanS' }, 'Use DanS panel') : null,
    c.judgeIds.length ? h('button', { class: 'ghost', onclick: () => window.dp.panelClear(c.id).then(apply) }, 'Clear') : null);
  const grid = h('div', { class: 'pick' }, S.judges.map((j) => h('button', {
    class: 'pick-j' + (chosen.has(j.personId) ? ' on' : '') + (dans.has(j.personId) ? ' dans' : ''),
    title: (chosen.has(j.personId) ? 'Remove from' : 'Add to') + ' the panel' + (dans.has(j.personId) ? ' (in the DanS panel)' : ''),
    onclick: () => window.dp.panelToggle(c.id, j.personId).then(apply),
  },
  h('span', { class: 'pj-ph' }, j.photo ? cropImg(j.photo, j.crop) : null),
  h('span', { class: 'jletter' }, j.letter || '–'),
  h('span', { class: 'pj-name' }, j.displayName || `${j.name} ${j.surname}`))));
  return [tools, S.judges.length ? grid : h('p', { class: 'empty' }, 'No judges in this event’s data. Fetch the data from DanS first.')];
}

// ---- Style tab ----
// Inputs carry data-theme="<field>"; their values come from S.theme (theme.js in the main process).
function renderStyle() {
  const t = S.theme;
  $('#style-for').textContent = S.event
    ? `Style of ${S.event.name}. Every event keeps its own. Changes appear on the projection after you push.`
    : 'Choose an event first; every event keeps its own style.';
  for (const el of $$('[data-theme]')) {
    if (el.type === 'checkbox') el.checked = t[el.dataset.theme] !== false; // on/off fields, e.g. the header card
    else if (document.activeElement !== el) el.value = t[el.dataset.theme];
  }
  $$('#bg-kind .chip').forEach((b) => b.classList.toggle('active', b.dataset.bg === t.background));
  $('#bg-image').hidden = t.background !== 'image';
  const thumb = $('#bg-thumb');
  thumb.style.backgroundImage = t.imageUrl ? `url("${t.imageUrl}")` : '';
  thumb.textContent = t.imageUrl ? '' : 'Drop an image here or click to choose';
  $('#bg-remove').hidden = !t.image;
  $('#bg-none-hint').hidden = t.background !== 'none';
  // ready-made styles (theme.js PRESETS); the one matching the current colours is marked
  const same = (p) => Object.entries(p.theme).every(([key, v]) => String(t[key]).toUpperCase() === String(v).toUpperCase());
  $('#presets').replaceChildren(...(S.presets || []).map((p) => h('button', {
    class: 'chip' + (same(p) ? ' active' : ''), title: 'Use the colours of ' + p.name,
    onclick: () => window.dp.themePreset(p.id).then(apply),
  }, h('span', { class: 'sw', style: `background:${p.theme.accent}` }), h('span', { class: 'sw', style: `background:${p.theme.ground}` }), p.name)));
  // transparent background: the previews show a checkerboard where OBS will show its own background
  $$('.pv').forEach((el) => el.classList.toggle('transparent', t.background === 'none'));
}
// Colours are sent when the picker closes ("change"); sliders while dragging, so the preview follows.
for (const el of $$('[data-theme]')) {
  const value = () => (el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value);
  const send = () => window.dp.setTheme({ [el.dataset.theme]: value() }).then(apply);
  el.addEventListener(el.type === 'range' ? 'input' : 'change', send);
}
$('#bg-kind').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  // Choosing "Image" without an image opens the file dialog straight away
  if (b.dataset.bg === 'image' && !S.theme.image) window.dp.themeImage().then(apply);
  else window.dp.setTheme({ background: b.dataset.bg }).then(apply);
});
(() => {
  const thumb = $('#bg-thumb');
  thumb.addEventListener('click', () => window.dp.themeImage().then(apply));
  thumb.addEventListener('dragover', (e) => { e.preventDefault(); thumb.classList.add('drag'); });
  thumb.addEventListener('dragleave', () => thumb.classList.remove('drag'));
  thumb.addEventListener('drop', (e) => { e.preventDefault(); thumb.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) window.dp.themeImage(f).then(apply); });
})();
$('#bg-remove').addEventListener('click', () => window.dp.themeImageRemove().then(apply));
$('#theme-reset').addEventListener('click', () => window.dp.themeReset().then(apply));

// ---- Projection box ----
let fetching = false;                       // a Fetch now is running (keeps its button disabled)
let previewPath = '/out/judges.html?slot=A'; // page shown in the two previews
let previewPort = null;                      // its port when it is not the judges' server (competitors, C-32)
function renderProjection() {
  const p = S.projection;
  $('#proj-auto').checked = p.auto;
  const changes = p.changes || [];
  $('#push').disabled = p.auto || !changes.length;
  $('#push').classList.toggle('ready', !p.auto && changes.length > 0);
  $('#proj-changes').replaceChildren(...(p.auto
    ? [h('span', { class: 'sub' }, 'Every change goes on screen straight away.')]
    : changes.length
      ? [h('b', null, 'Not on screen yet: '), changes.join(', ')]
      : [h('span', { class: 'sub' }, 'The screen shows the prepared state.')]));
  $('#proj-changes').classList.toggle('pending', !p.auto && changes.length > 0);
  $('#proj-pushed').textContent = p.pushedAt ? `Last push ${stamp(p.pushedAt)}` : 'Nothing pushed yet';
  // page list for the previews
  const sel = $('#preview-page');
  const pages = S.outputs?.pages || [];
  if (sel.options.length !== pages.length) {
    sel.replaceChildren(...pages.map((pg) => h('option', { value: `${pg.port || ''}|${pg.path}`, selected: pg.path === previewPath && (pg.port || null) === previewPort }, pg.name)));
  }
  renderPreviews(false);
}
// Each preview is the background page with the output page on top, like the scene in OBS, scaled down from
// 1920×1080. "Prepared" uses ?view=draft, "On screen" shows exactly what OBS gets. The frames poll the output
// server themselves, so they are only rebuilt when the page choice changes.
function renderPreviews(force) {
  if (!S.outputs) return;
  // the competitor page is shown from its own server, whose draft/pushed are the competitor ones
  const base = previewPort ? `http://localhost:${previewPort}` : S.outputs.base;
  for (const [id, view] of [['#pv-draft', 'draft'], ['#pv-live', 'live']]) {
    const box = $(id);
    const sep = previewPath.includes('?') ? '&' : '?';
    const src = `${base}${previewPath}${sep}view=${view}`;
    if (!force && box.dataset.src === src) continue;
    box.dataset.src = src;
    box.replaceChildren(
      h('iframe', { src: `${base}/brand/background.html?view=${view}`, tabindex: '-1', scrolling: 'no' }),
      h('iframe', { src, tabindex: '-1', scrolling: 'no' }));
  }
}

function apply(state) {
  if (!state) return;
  S = state;
  renderBar(); renderComps(); renderSlots(); renderOutputs(); renderJudges(); renderSettings();
  renderPanels(); renderStyle(); renderProjection();
  renderCompetitors(); renderCompProjection(); // competitors.js
}

// events
$('#server-form').addEventListener('submit', (e) => { e.preventDefault(); window.dp.setServer($('#server').value.trim()).then(apply); });
$('#server-pick').addEventListener('change', (e) => { if (e.target.value) window.dp.setServer(e.target.value).then(apply); });
$('#server').addEventListener('input', () => { $('#server-save').textContent = savedServer($('#server').value) ? 'Edit…' : 'Save…'; });
let editingServer = null; // url of the saved entry open in the dialog, null for a new one
$('#server-save').addEventListener('click', () => {
  const url = normServer($('#server').value) || S.config.server;
  const cur = savedServer(url);
  editingServer = cur?.url || null;
  $('#server-dlg-title').textContent = cur ? 'Edit saved server' : 'Save server';
  $('#server-name').value = cur?.name || '';
  $('#server-url').value = url;
  $('#server-delete').hidden = !cur;
  $('#server-dlg').showModal();
  $('#server-name').focus();
});
$('#server-delete').addEventListener('click', () => { window.dp.removeServer(editingServer).then(apply); $('#server-dlg').close('cancel'); });
$('#server-dlg form').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  window.dp.saveServer({ name: $('#server-name').value, url: $('#server-url').value }, editingServer).then(apply);
});
$('#event').addEventListener('change', (e) => window.dp.setEvent(e.target.value || null).then(apply));
$('#refresh-events').addEventListener('click', () => window.dp.refreshEvents().then(apply));
$('#search').addEventListener('input', (e) => { search = e.target.value.trim(); renderComps(); });
$('#filter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; filter = b.dataset.f; $$('#filter .chip').forEach((x) => x.classList.toggle('active', x === b)); renderComps(); });
$('#jfilter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; jfilter = b.dataset.f; $$('#jfilter .chip').forEach((x) => x.classList.toggle('active', x === b)); renderJudges(); });
$('#jsearch').addEventListener('input', (e) => { jsearch = e.target.value.trim(); renderJudges(); });
// Import folder…: the main process opens the folder dialog, imports and returns a report
$('#gallery-import').addEventListener('click', async () => {
  const { state, report } = await window.dp.galleryImport();
  apply(state); showImportReport(report);
});
// New judge…: small dialog with IDT, name and surname
$('#judge-new').addEventListener('click', () => {
  for (const id of ['#nj-idt', '#nj-name', '#nj-surname']) $(id).value = '';
  $('#nj-error').textContent = '';
  $('#judge-dlg').showModal();
  $('#nj-idt').focus();
});
$('#judge-dlg form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault(); // keep the dialog open until the IDT is accepted
  const st = await window.dp.judgeCreate({ fedId: $('#nj-idt').value, name: $('#nj-name').value, surname: $('#nj-surname').value });
  if (st.error) { $('#nj-error').textContent = st.error; return; }
  $('#judge-dlg').close(); apply(st);
});
$('#host').addEventListener('change', renderOutputs);
$('#split').addEventListener('change', (e) => window.dp.setOption({ split: e.target.checked }).then(apply));
$('#lang-primary').addEventListener('change', (e) => window.dp.setOption({ language: { primary: e.target.value, secondary: $('#lang-secondary').value } }).then(apply));
$('#lang-secondary').addEventListener('change', (e) => window.dp.setOption({ language: { primary: $('#lang-primary').value, secondary: e.target.value } }).then(apply));
$('#running-states').addEventListener('change', (e) => window.dp.setOption({ runningStates: e.target.value.split(/[\s,]+/) }).then(apply));
// Tabs: each button's data-tab names the section with id tab-<name>
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  for (const x of $$('.tab')) $('#tab-' + x.dataset.tab).hidden = x !== t;
  // the previews follow: competitor page on the Competitors tab, the judge page when leaving it
  const compPage = S?.outputs?.pages.find((p) => p.port);
  const onComp = t.dataset.tab === 'competitors';
  if (compPage && onComp !== !!previewPort) {
    previewPath = onComp ? compPage.path : '/out/judges.html?slot=A';
    previewPort = onComp ? compPage.port : null;
    $('#preview-page').value = `${previewPort || ''}|${previewPath}`;
    renderPreviews(true);
  }
}));
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) window.dp.setMode(b.dataset.mode).then(apply); });
// Fetch now (top bar) and Fetch from DanS (Judge selection) do the same read. Both are disabled while it runs
// so a double click doesn't send two reads.
async function fetchNow(btn) {
  if (fetching) return;
  fetching = true;
  $('#fetch-now').disabled = true; $('#fetch-now').textContent = 'Fetching…';
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }
  try { apply(await window.dp.fetchNow()); }
  finally {
    fetching = false; $('#fetch-now').textContent = 'Fetch now';
    if (S) { renderBar(); renderPanels(); }
  }
}
$('#fetch-now').addEventListener('click', () => fetchNow());
$('#push').addEventListener('click', () => window.dp.push().then(apply));
$('#proj-auto').addEventListener('change', (e) => window.dp.setProjectionAuto(e.target.checked).then(apply));
$('#preview-page').addEventListener('change', () => {
  const [port, path] = $('#preview-page').value.split('|');
  previewPath = path; previewPort = port ? Number(port) : null;
  renderPreviews(true);
});

window.dp.onState(apply);
window.dp.onStatus((st) => { if (S) { S.status = st; renderStatus(); } });
setInterval(() => S && renderStatus(), 1000);
window.dp.state().then(apply);
