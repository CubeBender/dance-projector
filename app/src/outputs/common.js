// Shared helpers for output pages: live state (polling), the event's style, slot selection, bilingual labels,
// tiny DOM builder.
//
// Query options every page understands:
//   ?view=draft  show what the operator is preparing instead of what was pushed (used by the app's preview)
//   ?bg=1        paint the style's background behind the page (for looking at a page outside OBS)
//   ?scale=0.5   zoom the page
(function () {
  const q = new URLSearchParams(location.search);
  const view = q.get('view') === 'draft' ? 'draft' : 'live';
  const debug = q.has('bg') || q.has('debug');
  if (debug) document.body.classList.add('bg');
  if (q.get('scale')) document.documentElement.style.zoom = q.get('scale');

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('--')) e.style.setProperty(k, v);
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
    return e;
  }

  // ---- language ----
  const TEXT = {
    cs: {
      heat: (n) => `Skupina ${n}`, final: 'Finále', all: 'Všichni', judges: 'Porota', now: 'Tančí se', none: 'Bez soutěže',
      advance: (a, b) => `${a} → ${b} postupuje`, inFinal: (a) => `${a} ve finále`,
    },
    en: {
      heat: (n) => `Heat ${n}`, final: 'Final', all: 'All', judges: 'Judges', now: 'Now dancing', none: 'No competition',
      advance: (a, b) => `${a} → ${b} advance`, inFinal: (a) => `${a} in the final`,
    },
  };
  let LANGS = ['cs', 'en'];
  function setLanguage(state) {
    const l = state.language || { primary: 'cs', secondary: 'en' };
    const p = q.get('lang') || l.primary;
    const s = q.has('lang2') ? q.get('lang2') : l.secondary;
    LANGS = [p, s && s !== 'none' && s !== p ? s : null];
  }
  const tr = (lang, key, ...a) => { const v = TEXT[lang]?.[key] ?? TEXT.cs[key]; return typeof v === 'function' ? v(...a) : v; };
  const ROUND_EN = [[/^(\d+)\.\s*kolo$/i, 'Round $1'], [/^finále$/i, 'Final'], [/^semifinále$/i, 'Semi-final'],
    [/^čtvrtfinále$/i, 'Quarter-final'], [/^osmifinále$/i, 'Eighth-final'], [/^opravné kolo$/i, 'Redance']];
  function roundName(name, lang) {
    if (lang !== 'en' || !name) return name;
    for (const [re, rep] of ROUND_EN) if (re.test(name)) return name.replace(re, rep);
    return name;
  }
  const L = {
    title: (c) => (lang) => (lang === 'en' ? c.titleEn || c.title : c.title),
    side: (s) => (lang) => (lang === 'en' ? s.labelEn || s.label : s.label || s.labelEn),
    dance: (d) => (lang) => (lang === 'en' ? d.nameEn || d.name : d.nameCs || d.name),
    round: (r) => (lang) => roundName(r.name, lang),
    t: (key, ...a) => (lang) => tr(lang, key, ...a),
  };
  // Primary text with the second language smaller underneath (or beside, with class "inline").
  function bi(fn, cls = '') {
    const [p, s] = LANGS;
    const a = fn(p), b = s ? fn(s) : null;
    return h('span', { class: 'bi ' + cls }, h('span', { class: 'p' }, a), b && b !== a ? h('span', { class: 's' }, b) : null);
  }

  // ---- style (theme.js in the app) ----
  // "#090B12" + 80 -> "rgba(9, 11, 18, 0.8)"
  function rgba(hex, pct) {
    const n = parseInt(String(hex || '#090B12').slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${(pct ?? 80) / 100})`;
  }
  // Turns the style into CSS variables used by common.css and the pages:
  //   --accent  main accent    --plate  colour of the plates behind text
  // With ?bg=1 it also paints the background (colour or image) so a page can be checked outside OBS.
  function applyTheme(t) {
    if (!t) return;
    const root = document.documentElement.style;
    root.setProperty('--accent', t.accent);
    root.setProperty('--plate', rgba(t.panel, t.panelOpacity));
    if (debug) {
      const dim = `linear-gradient(rgba(0,0,0,${(t.imageDim ?? 40) / 100}), rgba(0,0,0,${(t.imageDim ?? 40) / 100}))`;
      document.body.style.background = t.imageUrl
        ? `${dim}, url("${t.imageUrl}") center / cover, ${t.ground}`
        : `radial-gradient(ellipse at 30% 0%, ${rgba(t.accent, 30)}, transparent 60%), ${t.ground}`;
    }
  }

  // Calls render(state) on every change; keeps the last good state if the app is briefly unreachable.
  // Polls once a second with short requests (no held-open connection; see server.js for why).
  function live(render, everyMs = Number(q.get('poll') || 1000)) {
    let last = null, version = 0;
    const go = (s) => { last = s; setLanguage(s); applyTheme(s.theme); try { render(s); } catch (e) { console.error(e); } };
    async function poll() {
      try {
        const r = await fetch(`/api/state?view=${view}&since=${version}`, { cache: 'no-store' });
        if (r.status === 200) { const s = await r.json(); version = s.version || 0; go(s); }
      } catch { /* app restarting: keep showing the last state */ }
      setTimeout(poll, everyMs);
    }
    poll();
    return () => last;
  }

  // Re-render only when the visible content changes, so routine polls don't restart animations.
  function keyed(container, key, build) {
    key = JSON.stringify([LANGS, key]);
    if (container.dataset.key === key) return false;
    container.dataset.key = key;
    container.replaceChildren(...[].concat(build()));
    return true;
  }

  function roundMeta(r) {
    return (lang) => {
      const count = r.competes ? (r.advances ? tr(lang, 'advance', r.competes, r.advances) : tr(lang, 'inFinal', r.competes)) : '';
      return [roundName(r.name, lang), count].filter(Boolean).join(' · ');
    };
  }

  function header(slot, comp, { showDances = true } = {}) {
    const r = comp.round;
    const plate = h('div', { class: 'head enter' },
      h('div', { class: 'card' }, comp.number),
      h('div', { class: 'head-text' }, h('div', { class: 'title' }, bi(L.title(comp))), r ? h('div', { class: 'meta' }, bi(roundMeta(r))) : null),
      slot.label || slot.labelEn ? h('div', { class: 'side-chip caps' }, bi(L.side(slot))) : null);
    if (!showDances || !r || !r.dances.length) return [plate];
    const cur = r.dances[r.currentDance] || r.dances[0];
    const track = h('div', { class: 'dances enter', '--i': 2 },
      h('div', { class: 'dance-now' }, bi(L.dance(cur))),
      r.dances.map((d, i) => h('div', { class: 'pill' + (i === r.currentDance ? ' now' : d.completed ? ' done' : '') }, d.abbr)));
    return [plate, track];
  }

  function applySide(el, slot) { el.style.setProperty('--side', slot?.color || '#1E7BFF'); }

  // Judge photo with the saved crop: focus point x/y in percent and zoom.
  function photo(url, crop) {
    const c = crop || { x: 50, y: 30, zoom: 1 };
    return h('img', { class: 'crop-img', src: url, alt: '', style: {
      objectPosition: `${c.x}% ${c.y}%`, transformOrigin: `${c.x}% ${c.y}%`, transform: `scale(${c.zoom})` } });
  }

  window.DP = { q, debug, h, bi, L, live, keyed, header, applySide, photo, slotKey: (q.get('slot') || 'A').toUpperCase(), langs: () => LANGS };
})();
