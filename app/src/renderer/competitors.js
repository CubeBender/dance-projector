'use strict';
// Competitors tab (decision D-22). Loaded after app.js and uses its helpers ($, $$, h, S, apply, cropImg, dropZone,
// openCrop…): classic scripts share their top-level names.
//
// Three blocks:
//   cscreen – what the competitor projection shows: header, numbers in the round (from DanS or typed), round/spotlight
//   cphone  – phone upload page: switch, QR code, link (C-34)
//   clist   – every competitor of the event with photos and names (DanS start list + what the app keeps)
// Photos come in by drop, file picker, Ctrl+V (C-35), webcam, or the phone. Everything goes through window.dp
// (preload.js); nothing here touches files or the network.

// A competitor is addressed by its key ('dans:<id>' / 'm:<id>'); many have no start number until competition staff
// give them in DanS (D-23, C-37). Numbers are used only for the round and for "photo for number …".
let cfilter = 'all', csearch = '';
let csel = null;               // key of the selected card: Ctrl+V pastes there
const cstsNote = new Map();    // key -> message of the last ČSTS lookup, shown on the card
const notices = [];            // last few notices (photos from the phone), newest first

const inRound = (n) => !!n && (S.competitorScreen?.numbers || []).includes(n);
// the competitor with a start number; a DanS one first (its number is the real one)
const compBy = (n) => S.competitors.find((c) => c.number === n && c.inDans) || S.competitors.find((c) => c.number === n) || null;
const eventName = (key) => S.events.find((e) => e.id === key)?.name || 'the other event';

// Message strip at the bottom of the window; kind 'err' for problems.
let toastTimer = null;
function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text; el.className = 'toast ' + kind; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 7000 : 4000);
}
// For calls that may come back with { error }: draw the state and show the error.
const applyOr = (st) => { apply(st); if (st?.error) toast(st.error, 'err'); return st; };

// ---------------------------------------------------------------------------------------------------------
// What is on the competitor screen
// ---------------------------------------------------------------------------------------------------------

function renderCompScreen() {
  const wrap = $('#cscreen');
  if (wrap.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // typing
  const scr = S.competitorScreen || {};
  const comp = S.competitions.find((c) => c.id === scr.competitionId) || null;

  // competition the header (and "Load from DanS round") comes from
  const pick = h('select', { title: 'DanS competition for the header and for loading the round' },
    h('option', { value: '' }, S.competitions.length ? '— no DanS competition (typed header only) —' : '— no DanS data —'),
    S.competitions.map((c) => h('option', { value: c.id, selected: c.id === scr.competitionId }, `${c.number} · ${c.title}${c.round ? ' · ' + c.round.name : ''}`)));
  pick.addEventListener('change', () => window.dp.compScreen({ competitionId: pick.value || null }).then(applyOr));
  const load = h('button', {
    class: 'primary', disabled: !comp?.round,
    title: S.mode === 'manual' ? 'Uses the offline copy of the round (Manual mode never contacts DanS)' : 'Reads the start list and the draw of this round from DanS (2 requests)',
    onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Loading…';
      try { applyOr(await window.dp.compLoadRound(comp.id)); } finally { e.target.textContent = 'Load from DanS round'; e.target.disabled = false; }
    },
  }, 'Load from DanS round');
  const loaded = scr.roundId ? h('span', { class: 'src dans' }, `Numbers from DanS: ${scr.roundName}`) : null;
  // start numbers are given by competition staff in DanS, usually after the start list was first read
  const numbered = S.competitors.filter((c) => c.inDans && c.number).length, inDans = S.competitors.filter((c) => c.inDans).length;
  const refresh = h('button', {
    disabled: S.mode === 'manual', title: S.mode === 'manual' ? 'Manual mode never contacts DanS' : 'Read the start list from DanS again (1 request) to pick up start numbers given since',
    onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Reading…';
      try { applyOr(await window.dp.compRefreshStartlist()); } finally { e.target.textContent = 'Refresh start list'; e.target.disabled = false; }
    },
  }, 'Refresh start list');
  const numbersInfo = h('span', { class: 'sub' }, inDans ? `${numbered} of ${inDans} DanS competitors have a start number` : 'No DanS start list read yet');

  // typed header; empty fields fall back to the DanS competition (shown as placeholders)
  const field = (key, label, placeholder, cls = '') => {
    const input = h('input', { value: scr[key] || '', placeholder: placeholder || '', class: cls });
    input.addEventListener('change', () => window.dp.compScreen({ [key]: input.value }).then(applyOr));
    return h('label', { class: 'stack' }, h('small', null, label), input);
  };
  const details = h('div', { class: 'own-details' },
    field('number', 'No.', comp?.number != null ? String(comp.number) : '–', 'num'),
    field('title', 'Competition (main language)', comp?.title || 'optional'),
    field('titleEn', 'Competition (second language)', 'optional'),
    field('round', 'Round', scr.roundName || 'optional, e.g. Finále'));

  // numbers in the round: typed or loaded; Enter / leaving the field saves
  const numbers = scr.numbers || [];
  const nums = h('input', { class: 'cnums', value: numbers.join(' '), placeholder: 'e.g. 12 45 67 101', spellcheck: 'false' });
  nums.addEventListener('change', () => window.dp.compScreen({ numbers: nums.value }).then(applyOr));
  const unknown = numbers.filter((n) => { const c = compBy(n); return !c || !c.label; });
  const noPhoto = numbers.filter((n) => compBy(n) && !compBy(n).photos.length);
  const warn = [
    unknown.length ? h('span', { class: 'err' }, `No name: ${unknown.join(', ')}`) : null,
    noPhoto.length ? h('span', { class: 'warn' }, `No photo: ${noPhoto.join(', ')}`) : null,
  ];

  // round / spotlight; in spotlight one number of the round is picked
  const mode = scr.mode === 'spotlight' ? 'spotlight' : 'round';
  const modes = h('div', { class: 'chips' },
    h('button', { class: 'chip' + (mode === 'round' ? ' active' : ''), onclick: () => window.dp.compScreen({ mode: 'round' }).then(applyOr) }, 'Whole round'),
    h('button', { class: 'chip' + (mode === 'spotlight' ? ' active' : ''), onclick: () => window.dp.compScreen({ mode: 'spotlight' }).then(applyOr) }, 'Spotlight (one)'));
  const spot = mode === 'spotlight'
    ? h('div', { class: 'spot-pick' }, numbers.length
      ? numbers.slice().sort((a, b) => a - b).map((n) => h('button', {
        class: 'pick-c' + (String(scr.spotlight) === n ? ' on' : ''), title: 'Show this competitor large',
        onclick: () => window.dp.compScreen({ spotlight: n }).then(applyOr),
      }, h('b', null, n), ' ', compBy(n)?.label || ''))
      : h('span', { class: 'sub' }, 'Put numbers in the round first.'))
    : null;

  wrap.replaceChildren(h('section', { class: 'pnl', '--c': S.theme.accent },
    h('div', { class: 'pnl-head' }, h('b', null, 'On the competitor screen'), h('span', { class: 'sub' }, `${numbers.length} in the round · own port ${S.outputs?.pages.find((p) => p.port)?.port || ''}`)),
    h('div', { class: 'pnl-tools' }, pick, load, loaded),
    h('div', { class: 'pnl-tools' }, refresh, numbersInfo),
    details,
    h('label', { class: 'stack' }, h('small', null, 'Start numbers in the round (separated by spaces or commas)'), nums),
    h('div', { class: 'pnl-tools' }, ...warn),
    h('div', { class: 'pnl-tools' }, h('b', null, 'Show'), modes),
    spot));
}

// ---------------------------------------------------------------------------------------------------------
// Phone upload page (C-34)
// ---------------------------------------------------------------------------------------------------------

let qrFor = null; // url the QR picture currently shows
function renderPhone() {
  const wrap = $('#cphone');
  const up = S.upload || { enabled: false, urls: [] };
  const sw = h('input', { type: 'checkbox', checked: up.enabled });
  sw.addEventListener('change', () => window.dp.phoneUpload({ enabled: sw.checked }).then(applyOr));
  const parts = [h('label', { class: 'switch' }, sw, h('span', null, 'Phone upload page'),
    h('span', { class: 'sub' }, up.enabled ? 'on – anyone with the link on this network can send photos' : 'off'))];
  if (up.enabled) {
    if (!up.urls.length) parts.push(h('p', { class: 'err' }, 'This computer is on no network. Connect to the venue Wi-Fi or switch on the Windows mobile hotspot.'));
    else {
      // more than one network (e.g. cable + Wi-Fi): pick the one the phone is on
      const prev = wrap.querySelector('select')?.value;
      const url = up.urls.includes(prev) ? prev : up.urls[0];
      const sel = h('select', { title: 'Network the phone is on' }, up.urls.map((u) => h('option', { value: u, selected: u === url }, new URL(u).hostname)));
      const img = h('img', { class: 'qr', alt: 'QR code of the upload page' });
      const showQr = (u) => { qrFor = u; window.dp.qr(u).then((d) => { if (qrFor === u && d) img.src = d; }); };
      sel.addEventListener('change', () => { showQr(sel.value); link.textContent = sel.value; });
      showQr(url);
      const link = h('code', { class: 'url' }, url);
      parts.push(h('div', { class: 'phone-box' }, img, h('div', { class: 'phone-info' },
        h('p', null, 'The organizer scans this code with the phone camera, types the start number and takes the photo. It becomes that competitor\'s main photo here; push to show it.'),
        up.urls.length > 1 ? h('label', { class: 'stack' }, h('small', null, 'Network'), sel) : null,
        link,
        h('div', { class: 'pnl-tools' },
          h('button', { onclick: (e) => { navigator.clipboard.writeText(sel.value); e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy link'), 1200); } }, 'Copy link'),
          h('button', { class: 'ghost', title: 'Make a new link; the old QR code stops working', onclick: () => window.dp.phoneUpload({ newKey: true }).then(applyOr) }, 'New link')),
        h('p', { class: 'sub' }, 'The phone must be on the same network as this computer. If Windows asks about the firewall for Dance Projector, allow private networks.'),
        notices.length ? h('ul', { class: 'notices' }, notices.map((n) => h('li', null, `${new Date(n.at).toLocaleTimeString('cs-CZ')} · ${n.text}`))) : null)));
    }
  }
  wrap.replaceChildren(h('section', { class: 'pnl', '--c': S.theme.accent }, ...parts));
}

// ---------------------------------------------------------------------------------------------------------
// The competitor list
// ---------------------------------------------------------------------------------------------------------

// One person's fields (name, surname, IDT) with a Find button that asks ČSTS by IDT and fills the names in.
// onChange(): called after any field changed (the card then sends all its people at once).
function personFields(p, i, onChange, note) {
  const name = h('input', { value: p.name, placeholder: 'Name', 'data-f': 'name' });
  const surname = h('input', { value: p.surname, placeholder: 'Surname', 'data-f': 'surname' });
  const idt = h('input', { value: p.idt, placeholder: 'IDT', 'data-f': 'idt', inputmode: 'numeric', class: 'idt' });
  for (const el of [name, surname, idt]) el.addEventListener('change', onChange);
  const find = h('button', { type: 'button', class: 'ghost', title: 'Look up the name at ČSTS by this IDT' , onclick: async (e) => {
    if (!idt.value.trim()) { note('Type the IDT first'); return; }
    e.target.disabled = true; e.target.textContent = '…';
    try {
      const r = await window.dp.cstsLookup(idt.value.trim());
      if (r.error) note(r.error, true);
      else if (!r.found) note(`ČSTS has no member with IDT ${idt.value.trim()}`, true);
      else {
        name.value = r.found.name; surname.value = r.found.surname;
        note(r.found.guessed ? 'From ČSTS – check the name order' : `From ČSTS${r.found.club ? ' · ' + r.found.club : ''}`);
        onChange();
      }
    } finally { e.target.disabled = false; e.target.textContent = 'ČSTS'; }
  } }, 'ČSTS');
  return h('div', { class: 'person', 'data-i': i }, name, surname, idt, find);
}

// people of a card as currently typed
const readPeople = (card) => $$('.person', card).map((row) => Object.fromEntries($$('input', row).map((x) => [x.dataset.f, x.value])));

function compCard(c) {
  const n = c.number, key = c.key;
  // borrowed = the photo this dancer has in the other event of a two-day competition (C-38): shown, not editable here
  const main = c.photos.find((p) => p.file === c.main) || null;
  const own = !c.borrowed;
  const ph = h('div', { class: 'ph' + (main ? ' has' : '') + (c.kind === 'couple' ? ' sq' : '') + (c.borrowed ? ' borrowed' : ''),
    title: !main ? 'Click to choose photos, or drop / paste an image' : own ? 'Click to adjust the framing. Drop an image to add it as the main photo.' : `Photo from ${eventName(c.borrowed)}. Click or drop an image to give this event its own photo.` },
  main ? cropImg(main.url, main.crop) : 'Add photo', h('span', { class: 'cnum' + (n ? '' : ' none'), title: n ? 'Start number' : 'No start number yet' }, n || '–'));
  ph.addEventListener('click', (e) => { e.stopPropagation(); if (main && own) openCompCrop(c, main); else window.dp.compPhotosAdd(key).then(applyOr); });
  dropZone(ph, (files) => window.dp.compPhotosAdd(key, files, true).then(applyOr));

  const card = h('div', { class: 'ccard' + (csel === key ? ' sel' : '') + (inRound(n) ? ' inround' : ''), 'data-k': key });
  const noteEl = h('div', { class: 'sub cnote' }, cstsNote.get(key) || '');
  const note = (text, err = false) => { cstsNote.set(key, text); noteEl.textContent = text; noteEl.classList.toggle('err', err); };
  const save = () => window.dp.compUpdate(key, { people: readPeople(card) }).then(applyOr);
  const people = c.people.map((p, i) => personFields(p, i, save, note));
  const typedDiffers = c.inDans && c.stored && JSON.stringify(c.people.map((p) => [p.name, p.surname])) !== JSON.stringify((c.dansPeople || []).map((p) => [p.name, p.surname]));

  const kind = h('div', { class: 'chips mini' }, ['solo', 'couple'].map((k) => h('button', {
    class: 'chip' + (c.kind === k ? ' active' : ''), onclick: (e) => { e.stopPropagation(); window.dp.compUpdate(key, { kind: k }).then(applyOr); },
  }, k === 'solo' ? 'Solo' : 'Couple')));

  // the photo strip shows only this event's own photos; borrowed ones stay in their event
  const thumbs = own ? c.photos.map((p) => h('div', { class: 'thumb' + (p.file === c.main ? ' main' : '') },
    h('button', { class: 'thumb-img', title: p.file === c.main ? 'Main photo (shown on screen)' : 'Make this the main photo', onclick: () => window.dp.compPhotoMain(key, p.file).then(applyOr) }, cropImg(p.url, p.crop)),
    h('button', { class: 'thumb-del', title: 'Delete this photo (click twice)', onclick: (e) => {
      const b = e.currentTarget;
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Delete?'; setTimeout(() => { b.classList.remove('armed'); b.textContent = '×'; }, 3000); return; }
      window.dp.compPhotoDelete(key, p.file).then(applyOr);
    } }, '×'))) : [];
  const strip = h('div', { class: 'strip' }, thumbs,
    h('button', { class: 'thumb-add', title: 'Add photos (or drop them here)', onclick: () => window.dp.compPhotosAdd(key).then(applyOr) }, '+'));
  dropZone(strip, (files) => window.dp.compPhotosAdd(key, files).then(applyOr));
  // a typed competitor's number can be typed; a DanS competitor's number comes only from DanS (D-23)
  const numberField = c.inDans ? null : (() => {
    const input = h('input', { class: 'cnum-input', value: n || '', placeholder: 'no.', inputmode: 'numeric', maxlength: '4', title: 'Start number (typed competitor)' });
    input.addEventListener('change', () => window.dp.compUpdate(key, { number: input.value }).then(applyOr));
    return h('label', { class: 'row small' }, 'Start number', input);
  })();

  // Club and sponsor (D-27), shown on the competitor and results screens. DanS values are the placeholders: an empty
  // field uses them, typing replaces them (also for typed competitors, which have no DanS values).
  const extra = (field, label, dansValue) => {
    const input = h('input', { value: c.stored ? (c[field] !== dansValue ? c[field] : '') : '', placeholder: dansValue || (field === 'sponsor' ? 'none' : ''), 'data-x': field });
    input.addEventListener('change', () => window.dp.compUpdate(key, { [field]: input.value }).then(applyOr));
    return h('label', { class: 'stack' }, h('small', null, label), input);
  };
  const clubRow = h('div', { class: 'names' }, extra('club', 'Club', c.dansClub), extra('sponsor', 'Sponsor', c.dansSponsor));

  card.append(ph, h('div', { class: 'jinfo' },
    h('div', { class: 'jtop' }, h('span', { class: 'jname' }, c.label || h('span', { class: 'sub' }, 'No name yet')), kind),
    h('div', { class: 'jfed' },
      c.inDans ? h('span', { class: 'tag ev' }, 'DanS') : h('span', { class: 'tag new' }, { phone: 'From phone', gone: 'Not in the DanS start list' }[c.origin] || 'Typed'),
      c.inDans && !n ? h('span', { class: 'tag' }, 'No start number yet') : null,
      c.sameNumber ? h('span', { class: 'tag bad', title: 'Two competitors have this number; the round uses the DanS one' }, `Number ${n} twice`) : null,
      inRound(n) ? h('span', { class: 'tag round' }, 'In the round') : null,
      c.borrowed ? h('span', { class: 'tag', title: 'Same IDT. Add a photo here to use a different one in this event.' }, `Photo from ${eventName(c.borrowed)}`) : null,
      own && c.photos.length > 1 ? h('span', { class: 'tag' }, `${c.photos.length} photos`) : null),
    numberField,
    people,
    clubRow,
    typedDiffers ? h('div', { class: 'sub' }, `DanS has: ${(c.dansPeople || []).map((p) => `${p.name} ${p.surname}`).join(' & ')}`) : null,
    noteEl,
    strip,
    h('div', { class: 'jactions' },
      h('button', { class: inRound(n) ? '' : 'primary', disabled: !n, title: n ? null : 'No start number yet: the round is made of start numbers',
        onclick: () => window.dp.compInRound(n, !inRound(n)).then(applyOr) }, inRound(n) ? 'Take out of round' : 'Put in round'),
      h('button', { class: 'ghost', title: 'Take a photo with the webcam', onclick: () => openWebcam(c) }, 'Webcam…'),
      h('span', { class: 'spacer' }),
      c.stored ? h('button', { class: 'ghost danger', title: c.inDans ? 'Forget the names typed here and the photos' : 'Remove this competitor', onclick: (e) => {
        const b = e.currentTarget;
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again'; setTimeout(() => { b.classList.remove('armed'); b.textContent = c.inDans ? 'Reset…' : 'Delete…'; }, 3000); return; }
        window.dp.compDelete(key).then(applyOr);
      } }, c.inDans ? 'Reset…' : 'Delete…') : null)));
  // clicking a card (not a button or field in it) selects it as the target of Ctrl+V
  card.addEventListener('click', (e) => {
    if (e.target.closest('button, input, select')) return;
    csel = csel === key ? null : key;
    $$('.ccard', $('#clist')).forEach((x) => x.classList.toggle('sel', x.dataset.k === csel));
  });
  return card;
}

function renderCompList() {
  const wrap = $('#clist');
  if (wrap.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // typing in a card
  let list = S.competitors;
  if (cfilter === 'round') list = list.filter((c) => inRound(c.number));
  if (cfilter === 'nophoto') list = list.filter((c) => !c.photos.length);
  if (cfilter === 'own') list = list.filter((c) => !c.inDans);
  if (cfilter === 'nonumber') list = list.filter((c) => !c.number);
  if (csearch) {
    const q = csearch.toLowerCase();
    list = list.filter((c) => c.number === q || [c.label, ...c.people.flatMap((p) => [p.name, p.surname, p.idt])].join(' ').toLowerCase().includes(q));
  }
  // the round first, then as the main process sorted them (by number, competitors without one by surname)
  list = list.slice().sort((a, b) => inRound(b.number) - inRound(a.number));
  // A start list has ~300 entries; drawing all of them on every update is slow, so without a filter or search only
  // the round and the competitors with photos are drawn, plus the first 60.
  const total = list.length;
  if (cfilter === 'all' && !csearch && total > 80) list = list.filter((c, i) => inRound(c.number) || c.photos.length || !c.inDans || c.key === csel || i < 60);
  wrap.replaceChildren(...list.map(compCard));
  $('#ccount').textContent = `${S.competitors.length} competitors${list.length < total ? ` · ${list.length} shown, search to find the rest` : ''}`;
  const empty = $('#clist-empty');
  empty.hidden = list.length > 0;
  if (!list.length) empty.textContent = S.competitors.length ? 'Nobody matches the filter.' : 'No competitors yet. Load a round from DanS, add one with New competitor…, or paste a photo and type its number.';
}

function renderCompetitors() { renderCompScreen(); renderPhone(); renderCompList(); }

// The competitor half of the Projection box
function renderCompProjection() {
  const p = S.compProjection;
  if (!p) { $('#push-comp').disabled = true; return; }
  const auto = S.projection.auto, changes = p.changes || [];
  $('#push-comp').disabled = auto || !changes.length;
  $('#push-comp').classList.toggle('ready', !auto && changes.length > 0);
  $('#cproj-changes').replaceChildren(...(auto ? [h('span', { class: 'sub' }, 'Every change goes on screen straight away.')]
    : changes.length ? [h('b', null, 'Not on screen yet: '), changes.join(', ')] : [h('span', { class: 'sub' }, 'The screen shows the prepared state.')]));
  $('#cproj-changes').classList.toggle('pending', !auto && changes.length > 0);
  $('#cproj-pushed').textContent = p.pushedAt ? `Last push ${stamp(p.pushedAt)}` : 'Nothing pushed yet';
}
$('#push-comp').addEventListener('click', () => window.dp.pushCompetitors().then(applyOr));

// ---- list filters ----
$('#cfilter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; cfilter = b.dataset.f; $$('#cfilter .chip').forEach((x) => x.classList.toggle('active', x === b)); renderCompList(); });
$('#csearch').addEventListener('input', (e) => { csearch = e.target.value.trim(); renderCompList(); });

// ---- crop editor for competitor photos (shares the dialog with judges; app.js openCrop) ----
function openCompCrop(c, p) {
  crop.kind = 'comp'; crop.fedId = c.key; crop.file = p.file;
  crop.c = { ...(p.crop || { x: 50, y: 30, zoom: 1 }) };
  $('#crop-title').textContent = `Adjust photo – ${[c.number, c.label].filter(Boolean).join(' · ')}`;
  $('#crop-letter').textContent = c.number || '';
  $('#crop-frame').classList.toggle('sq', c.kind === 'couple'); // couples are framed square on screen
  $('#crop-img').src = p.url;
  showCrop();
  $('#crop').showModal();
}

// ---- New competitor… ----
let ncKind = 'solo';
function ncPeople() {
  const box = $('#nc-people');
  const old = $$('.person', box).map((row) => Object.fromEntries($$('input', row).map((x) => [x.dataset.f, x.value])));
  const note = (text, err) => { $('#nc-error').textContent = text; $('#nc-error').classList.toggle('ok', !err); };
  box.replaceChildren(...Array.from({ length: ncKind === 'couple' ? 2 : 1 }, (_, i) => personFields({ name: '', surname: '', idt: '', ...old[i] }, i, () => {}, note)));
}
$('#comp-new').addEventListener('click', () => {
  $('#nc-number').value = ''; $('#nc-error').textContent = ''; ncKind = 'solo';
  $$('#nc-kind .chip').forEach((x) => x.classList.toggle('active', x.dataset.k === ncKind));
  $('#nc-people').replaceChildren(); ncPeople();
  $('#comp-dlg').showModal(); $('#nc-number').focus();
});
$('#nc-kind').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  ncKind = b.dataset.k; $$('#nc-kind .chip').forEach((x) => x.classList.toggle('active', x === b)); ncPeople();
});
$('#nc-number').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#comp-dlg button.primary').click(); } });
$('#comp-dlg form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault(); // stays open until the number is accepted
  const st = await window.dp.compCreate({ number: $('#nc-number').value, kind: ncKind, people: readPeople($('#nc-people')) });
  if (st.error) { $('#nc-error').textContent = st.error; $('#nc-error').classList.remove('ok'); return; }
  $('#comp-dlg').close(); apply(st);
});

// ---- Ctrl+V: an image from the clipboard (C-35) ----
// Only on the Competitors tab and not while typing in a field (there Ctrl+V pastes text as usual).
let pasted = null; // bytes waiting for a number in the "Photo for which number?" dialog
document.addEventListener('paste', async (e) => {
  if ($('#tab-competitors').hidden || document.querySelector('dialog[open]')) return;
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const item = [...(e.clipboardData?.items || [])].find((x) => x.kind === 'file' && x.type.startsWith('image/'));
  if (!item) { toast('The clipboard holds no image. In WhatsApp Desktop right-click the photo and choose Copy.', 'err'); return; }
  e.preventDefault();
  const bytes = new Uint8Array(await item.getAsFile().arrayBuffer());
  if (csel) {
    const c = S.competitors.find((x) => x.key === csel);
    toast(`Adding the photo to ${[c?.number, c?.label].filter(Boolean).join(' · ') || 'the selected competitor'}…`);
    applyOr(await window.dp.compPhotoBytes({ key: csel }, bytes, true)); return;
  }
  pasted = bytes;
  $('#paste-img').src = URL.createObjectURL(new Blob([bytes], { type: item.type }));
  $('#paste-number').value = ''; $('#paste-who').textContent = ' ';
  $('#paste-dlg').showModal(); $('#paste-number').focus();
});
$('#paste-number').addEventListener('input', () => {
  const c = compBy(String(Number($('#paste-number').value.trim()) || ''));
  $('#paste-who').textContent = c ? (c.label || 'no name yet') : $('#paste-number').value.trim() ? 'new number – it will be added' : ' ';
});
// Enter in the number field means "Use photo" (the form's first button is Cancel, which Enter would press)
$('#paste-number').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#paste-dlg button.primary').click(); } });
$('#paste-dlg form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') { pasted = null; return; }
  if (!pasted) return;
  e.preventDefault(); // stays open until the number is accepted
  const st = await window.dp.compPhotoBytes({ number: $('#paste-number').value.trim() }, pasted, true);
  if (st.error) { $('#paste-who').textContent = st.error; return; }
  pasted = null; $('#paste-dlg').close(); apply(st);
  csel = st.key || null; renderCompList(); // the next paste goes to the same competitor
});

// ---- Webcam (C-35) ----
// Live view of a camera. The choice is remembered; without one, a camera named "Logitech" is preferred.
let camFor = null, camStream = null;
function stopCam() { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; }
async function startCam(deviceId) {
  stopCam();
  $('#cam-err').textContent = '';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    $('#cam-video').srcObject = camStream;
  } catch (e) { $('#cam-err').textContent = `The camera could not be opened: ${e.message}`; }
}
async function openWebcam(c) {
  camFor = c.key;
  $('#cam-title').textContent = `Webcam – ${[c.number, c.label].filter(Boolean).join(' · ')}`;
  $('#cam-dlg').showModal();
  // labels of cameras are only known once access was granted, so open one first, then list them
  await startCam(S.webcamId);
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const current = camStream?.getVideoTracks()[0]?.getSettings().deviceId;
  const preferred = cams.find((d) => d.deviceId === S.webcamId) || cams.find((d) => /logitech/i.test(d.label)) || cams.find((d) => d.deviceId === current) || cams[0];
  $('#cam-device').replaceChildren(...cams.map((d, i) => h('option', { value: d.deviceId, selected: d === preferred }, d.label || `Camera ${i + 1}`)));
  if (preferred && preferred.deviceId !== current) await startCam(preferred.deviceId);
  if (!cams.length) $('#cam-err').textContent = 'No camera found. Is the webcam plugged in?';
}
$('#cam-device').addEventListener('change', (e) => { startCam(e.target.value); window.dp.setWebcam(e.target.value); });
$('#cam-dlg').addEventListener('close', stopCam);
async function shoot() {
  const v = $('#cam-video');
  if (!camStream || !v.videoWidth) return;
  const cv = document.createElement('canvas');
  cv.width = v.videoWidth; cv.height = v.videoHeight;
  cv.getContext('2d').drawImage(v, 0, 0);
  // toDataURL is synchronous; toBlob waits for a frame and was seen to stall in a window that isn't painted
  const data = cv.toDataURL('image/jpeg', 0.92);
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
  const key = camFor;
  $('#cam-dlg').close();
  applyOr(await window.dp.compPhotoBytes({ key }, bytes, true));
  toast('Photo taken. Click the photo to adjust the framing.');
}
$('#cam-shoot').addEventListener('click', shoot);
$('#cam-dlg').addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.tagName !== 'SELECT') { e.preventDefault(); shoot(); } });

// ---- notices from the main process (a photo arrived from the phone) ----
window.dp.onNotice((n) => {
  notices.unshift(n); notices.length = Math.min(notices.length, 5);
  toast(n.text);
  if (S) renderPhone();
});
