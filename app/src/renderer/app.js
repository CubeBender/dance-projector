'use strict';
// Operator window. Holds no data of its own: S is the latest state from the main process (rendererState() in
// main.js); every button calls window.dp.<something>() (preload.js) and redraws with the state it returns.
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
  if (document.activeElement !== $('#running-states')) $('#running-states').value = S.config.runningStates.join(', ');
}

// ---- Judge panel tab ----
// One block per competition on screen (slot A, and B when the floor is split). Shows the panel that will be
// projected and every judge of the event as a toggle button.
const PANEL_SOURCE = {
  dans: 'Panel from DanS',
  manual: 'Picked by hand',
  none: 'No panel yet',
};
function renderPanels() {
  const wrap = $('#panels');
  const keys = S.config.split ? ['A', 'B'] : ['A'];
  const blocks = keys.map((k) => {
    const slot = S.config.slots[k];
    const c = S.competitions.find((x) => x.id === slot.competitionId);
    const color = S.config.split ? slot.color : S.theme.accent;
    const head = h('div', { class: 'pnl-head' },
      h('span', { class: 'slot-key' }, S.config.split ? k : ''),
      c ? h('div', { class: 'pnl-title' }, h('b', null, `${c.number} · ${c.title}`), h('div', { class: 'sub' }, c.round ? `${c.round.name} · ${c.round.state}` : 'No round yet'))
        : h('div', { class: 'pnl-title' }, h('span', { class: 'sub' }, S.config.split ? `Nothing on side ${k}. Use the ${k} buttons in Competitions.` : 'Nothing on screen. Press Show in Competitions.')));
    if (!c) return h('section', { class: 'pnl', '--c': color }, head);

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
    return h('section', { class: 'pnl', '--c': color }, head, tools,
      S.judges.length ? grid : h('p', { class: 'empty' }, 'No judges in this event’s data. Fetch the data from DanS first.'));
  });
  wrap.replaceChildren(...blocks);
}

// ---- Style tab ----
// Inputs carry data-theme="<field>"; their values come from S.theme (theme.js in the main process).
function renderStyle() {
  const t = S.theme;
  $('#style-for').textContent = S.event
    ? `Style of ${S.event.name}. Every event keeps its own. Changes appear on the projection after you push.`
    : 'Choose an event first; every event keeps its own style.';
  for (const el of $$('[data-theme]')) if (document.activeElement !== el) el.value = t[el.dataset.theme];
  $$('#bg-kind .chip').forEach((b) => b.classList.toggle('active', b.dataset.bg === t.background));
  $('#bg-image').hidden = t.background !== 'image';
  const thumb = $('#bg-thumb');
  thumb.style.backgroundImage = t.imageUrl ? `url("${t.imageUrl}")` : '';
  thumb.textContent = t.imageUrl ? '' : 'Drop an image here or click to choose';
  $('#bg-remove').hidden = !t.image;
}
// Colours are sent when the picker closes ("change"); sliders while dragging, so the preview follows.
for (const el of $$('[data-theme]')) {
  const send = () => window.dp.setTheme({ [el.dataset.theme]: el.type === 'range' ? Number(el.value) : el.value }).then(apply);
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
    sel.replaceChildren(...pages.map((pg) => h('option', { value: pg.path, selected: pg.path === previewPath }, pg.name)));
  }
  renderPreviews(false);
}
// Each preview is the background page with the output page on top, like the scene in OBS, scaled down from
// 1920×1080. "Prepared" uses ?view=draft, "On screen" shows exactly what OBS gets. The frames poll the output
// server themselves, so they are only rebuilt when the page choice changes.
function renderPreviews(force) {
  if (!S.outputs) return;
  for (const [id, view] of [['#pv-draft', 'draft'], ['#pv-live', 'live']]) {
    const box = $(id);
    const sep = previewPath.includes('?') ? '&' : '?';
    const src = `${S.outputs.base}${previewPath}${sep}view=${view}`;
    if (!force && box.dataset.src === src) continue;
    box.dataset.src = src;
    box.replaceChildren(
      h('iframe', { src: `${S.outputs.base}/brand/background.html?view=${view}`, tabindex: '-1', scrolling: 'no' }),
      h('iframe', { src, tabindex: '-1', scrolling: 'no' }));
  }
}

function apply(state) {
  if (!state) return;
  S = state;
  renderBar(); renderComps(); renderSlots(); renderOutputs(); renderJudges(); renderSettings();
  renderPanels(); renderStyle(); renderProjection();
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
$('#host').addEventListener('change', renderOutputs);
$('#split').addEventListener('change', (e) => window.dp.setOption({ split: e.target.checked }).then(apply));
$('#lang-primary').addEventListener('change', (e) => window.dp.setOption({ language: { primary: e.target.value, secondary: $('#lang-secondary').value } }).then(apply));
$('#lang-secondary').addEventListener('change', (e) => window.dp.setOption({ language: { primary: $('#lang-primary').value, secondary: e.target.value } }).then(apply));
$('#running-states').addEventListener('change', (e) => window.dp.setOption({ runningStates: e.target.value.split(/[\s,]+/) }).then(apply));
// Tabs: each button's data-tab names the section with id tab-<name>
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  for (const x of $$('.tab')) $('#tab-' + x.dataset.tab).hidden = x !== t;
}));
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) window.dp.setMode(b.dataset.mode).then(apply); });
$('#fetch-now').addEventListener('click', async (e) => {
  // Disabled while the read runs so a double click doesn't send two reads
  fetching = true; e.target.disabled = true; e.target.textContent = 'Fetching…';
  try { apply(await window.dp.fetchNow()); }
  finally { fetching = false; e.target.textContent = 'Fetch now'; if (S) renderBar(); }
});
$('#push').addEventListener('click', () => window.dp.push().then(apply));
$('#proj-auto').addEventListener('change', (e) => window.dp.setProjectionAuto(e.target.checked).then(apply));
$('#preview-page').addEventListener('change', () => { previewPath = $('#preview-page').value; renderPreviews(true); });

window.dp.onState(apply);
window.dp.onStatus((st) => { if (S) { S.status = st; renderStatus(); } });
setInterval(() => S && renderStatus(), 1000);
window.dp.state().then(apply);
