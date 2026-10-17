'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let S = null;
let filter = 'all', jfilter = 'all', search = '';
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
const slotOf = (id) => Object.entries(S.config.slots).find(([, s]) => s.competitionId === id)?.[0] || null;

function renderStatus() {
  const st = S.status || {};
  const el = $('#status');
  const age = st.lastOk ? Math.round((Date.now() - st.lastOk) / 1000) : null;
  el.classList.toggle('ok', !!st.connected && age != null && age < 10);
  el.classList.toggle('stale', !!st.connected && age != null && age >= 10);
  let text = st.connected ? (age != null ? `Updated ${age < 2 ? 'just now' : age + ' s ago'}` : 'Connected') : (st.error ? `No connection: ${st.error}` : 'Not connected');
  if (!S.config.eventId && !S.fixture) text = st.error ? text : 'Choose an event';
  $('#status-text').textContent = text;
  const badge = $('#fixture-badge');
  if (S.fixture && !badge) el.prepend(h('span', { class: 'badge', id: 'fixture-badge' }, 'Snapshot'));
}

function renderBar() {
  if (document.activeElement !== $('#server')) $('#server').value = S.config.server;
  $('#server-form').hidden = !!S.fixture;
  $('#refresh-events').hidden = !!S.fixture;
  const sel = $('#event');
  const current = S.fixture ? S.event?.id : S.config.eventId;
  sel.replaceChildren(h('option', { value: '' }, S.events.length ? 'Choose an event…' : 'No events found'),
    ...S.events.map((e) => h('option', { value: e.id, selected: e.id === current }, `${e.date || ''}  ${e.abbreviation || ''}  ${e.name}`)));
  sel.disabled = !!S.fixture;
  renderStatus();
}

function compRow(c) {
  const slot = slotOf(c.id);
  const done = DONE.has(c.state);
  const r = c.round;
  return h('tr', { class: [c.running && 'running', done && 'done'].filter(Boolean).join(' ') },
    h('td', null, h('div', { class: 'slotbtns' }, (S.config.split ? ['A', 'B'] : ['A']).map((k) => h('button', {
      class: 'slotbtn' + (slot === k ? ' on' : '') + (S.config.split ? '' : ' wide'), '--c': S.config.split ? S.config.slots[k].color : S.config.wholeColor,
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
  $('#whole').hidden = split;
  $('#whole').style.setProperty('--c', S.config.wholeColor);
  if (document.activeElement !== $('#whole-color')) $('#whole-color').value = S.config.wholeColor;
  for (const el of $$('.slot', wrap)) {
    const k = el.dataset.slot, s = S.config.slots[k];
    el.hidden = !split && k === 'B';
    el.classList.toggle('single', !split);
    el.style.setProperty('--c', split ? s.color : S.config.wholeColor);
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
    const url = `http://${host}:${o.port}${p.path}`;
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
const crop = { fedId: null, c: null };
function showCrop() {
  const img = $('#crop-img'), c = crop.c;
  Object.assign(img.style, { objectPosition: `${c.x}% ${c.y}%`, transformOrigin: `${c.x}% ${c.y}%`, transform: `scale(${c.zoom})` });
  $('#crop-zoom').value = c.zoom;
}
function openCrop(j) {
  crop.fedId = j.fedId;
  crop.c = { ...(j.crop || { x: 50, y: 30, zoom: 1 }) };
  $('#crop-title').textContent = `Adjust photo – ${j.letter} ${j.name} ${j.surname}`;
  $('#crop-letter').textContent = j.letter || '';
  $('#crop-img').src = j.photo;
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
  $('#crop').addEventListener('close', () => {
    if ($('#crop').returnValue === 'save' && crop.fedId) window.dp.judgeCrop(crop.fedId, crop.c).then(apply);
  });
})();

function judgeCard(j) {
  const ph = h('div', { class: 'ph' + (j.photo ? ' has' : ''), title: j.photo ? 'Click to adjust the crop, or drop an image to replace it' : 'Click to choose a photo, or drop an image here' },
    j.photo ? cropImg(j.photo, j.crop) : 'Add photo');
  ph.addEventListener('click', () => { if (!j.fedId) return; if (j.photo) openCrop(j); else window.dp.judgePhoto(j.fedId).then(apply); });
  ph.addEventListener('dragover', (e) => { e.preventDefault(); ph.classList.add('drag'); });
  ph.addEventListener('dragleave', () => ph.classList.remove('drag'));
  ph.addEventListener('drop', (e) => { e.preventDefault(); ph.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f && j.fedId) window.dp.judgePhoto(j.fedId, f).then(apply); });
  const input = h('input', { value: j.displayName, placeholder: `${j.name} ${j.surname}`, title: 'Name shown on screen. Leave empty to use the federation name.' });
  input.addEventListener('change', () => window.dp.judgeName(j.fedId, input.value).then(apply));
  return h('div', { class: 'judge' + (j.inSlots ? ' on' : '') },
    ph,
    h('div', { class: 'jinfo' },
      h('div', { class: 'jtop' }, h('span', { class: 'jletter' }, j.letter || '–'), h('span', { class: 'jname' }, `${j.name} ${j.surname}`)),
      h('div', { class: 'jfed' }, `Federation ID ${j.fedId || '–'}${j.country ? ' · ' + j.country : ''}`),
      h('label', { class: 'stack' }, h('small', null, 'Name on screen'), input),
      j.photo ? h('div', { class: 'jactions' },
        h('button', { onclick: () => openCrop(j) }, 'Adjust crop'),
        h('button', { onclick: () => window.dp.judgePhoto(j.fedId).then(apply) }, 'Change photo'),
        h('button', { onclick: () => window.dp.judgePhotoRemove(j.fedId).then(apply) }, 'Remove')) : null));
}

function renderJudges() {
  let list = S.judges;
  if (jfilter === 'slots') list = list.filter((j) => j.inSlots);
  const wrap = $('#judges');
  if (wrap.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // don't steal focus while typing
  wrap.replaceChildren(...list.map(judgeCard));
  const empty = $('#judges-empty');
  empty.hidden = list.length > 0;
  if (!list.length) empty.textContent = S.judges.length ? 'No judges in the competitions on screen.' : 'Choose an event to load its judges.';
}

function renderSettings() {
  $('#lang-primary').value = S.config.language.primary;
  $('#lang-secondary').value = S.config.language.secondary;
  $('#heats-show').value = S.config.heatsShow;
  if (document.activeElement !== $('#running-states')) $('#running-states').value = S.config.runningStates.join(', ');
}

function apply(state) {
  if (!state) return;
  S = state;
  renderBar(); renderComps(); renderSlots(); renderOutputs(); renderJudges(); renderSettings();
}

// events
$('#server-form').addEventListener('submit', (e) => { e.preventDefault(); window.dp.setServer($('#server').value.trim()).then(apply); });
$('#event').addEventListener('change', (e) => window.dp.setEvent(e.target.value || null).then(apply));
$('#refresh-events').addEventListener('click', () => window.dp.refreshEvents().then(apply));
$('#search').addEventListener('input', (e) => { search = e.target.value.trim(); renderComps(); });
$('#filter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; filter = b.dataset.f; $$('#filter .chip').forEach((x) => x.classList.toggle('active', x === b)); renderComps(); });
$('#jfilter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; jfilter = b.dataset.f; $$('#jfilter .chip').forEach((x) => x.classList.toggle('active', x === b)); renderJudges(); });
$('#host').addEventListener('change', renderOutputs);
$('#split').addEventListener('change', (e) => window.dp.setOption({ split: e.target.checked }).then(apply));
$('#whole-color').addEventListener('change', (e) => window.dp.setOption({ wholeColor: e.target.value }).then(apply));
$('#lang-primary').addEventListener('change', (e) => window.dp.setOption({ language: { primary: e.target.value, secondary: $('#lang-secondary').value } }).then(apply));
$('#lang-secondary').addEventListener('change', (e) => window.dp.setOption({ language: { primary: $('#lang-primary').value, secondary: e.target.value } }).then(apply));
$('#heats-show').addEventListener('change', (e) => window.dp.setOption({ heatsShow: e.target.value }).then(apply));
$('#running-states').addEventListener('change', (e) => window.dp.setOption({ runningStates: e.target.value.split(/[\s,]+/) }).then(apply));
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#tab-competitions').hidden = t.dataset.tab !== 'competitions';
  $('#tab-judges').hidden = t.dataset.tab !== 'judges';
}));

window.dp.onState(apply);
window.dp.onStatus((st) => { if (S) { S.status = st; renderStatus(); } });
setInterval(() => S && renderStatus(), 1000);
window.dp.state().then(apply);
