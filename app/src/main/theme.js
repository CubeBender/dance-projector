'use strict';
// Per-event colour scheme ("style") of the projection (decision D-15).
//
// A theme is a small plain object. It travels inside the output state to every output page and to the
// branding pages in OBS (obs/pages/brand.js), which turn it into CSS variables. Each event has its own
// theme stored in config.themes[eventId]; missing fields fall back to DEFAULT_THEME.

const DEFAULT_THEME = {
  accent: '#E8B931',    // main accent: whole-floor colour, rules, highlights
  secondary: '#1E7BFF', // second brand colour (second light pool of the background)
  ground: '#0A0D16',    // background base colour
  panel: '#090B12',     // colour of the plates behind text on the output pages
  text: '#F3F5F9',      // colour of names and titles; the quieter second colour is mixed from it and the plates
  panelOpacity: 80,     // 0–100 %, how solid those plates are (0 = no plates at all)
  // Height in px of a sponsor strip that OBS lays over the bottom of the content scenes (0 = none). The output pages
  // keep that much plus a small buffer free at the bottom, and then sit just as close to the top edge.
  strip: 0,
  // 'lights' (moving light pools) | 'solid' (ground colour only) | 'image' | 'none' (transparent: the background
  // is added in OBS, the background page shows nothing)
  background: 'lights',
  image: null,          // file name in <userData>/media, used when background === 'image'
  imageDim: 40,         // 0–90 %, darkens the image so text stays readable
};

const HEX = /^#[0-9a-f]{6}$/i;
const BACKGROUNDS = ['lights', 'solid', 'image', 'none'];

// Ready-made styles the operator can apply with one click (Style tab). Only colours and the background type;
// the image and its darkening stay as they are.
const PRESETS = {
  // MČR SÓLO 2026 (Praha, 21.–22. 11. 2026). Primary #BD9C66 (gold, logo) and secondary #1F1917 (warm near-black,
  // background) are the exact event colours from the organiser's logo files; #E8D6A6 is the cream of the poster text.
  // Transparent background, because the event background is composed in OBS. The OBS scenes have a 120 px sponsor
  // strip at the bottom ("MCR Sponsor Strip", OBS_transition/CLAUDE.md).
  mcr: {
    name: 'MČR SÓLO 2026',
    theme: { accent: '#BD9C66', secondary: '#E8D6A6', ground: '#1F1917', panel: '#1F1917', text: '#E8D6A6', panelOpacity: 88, background: 'none', strip: 120 },
  },
};

// Keeps only known fields with valid values. Used both for stored themes and for patches from the window,
// so a bad value can never reach the pages.
function cleanTheme(t = {}) {
  const out = {};
  for (const k of ['accent', 'secondary', 'ground', 'panel', 'text']) if (HEX.test(t[k] || '')) out[k] = t[k].toUpperCase();
  const pct = (v, max) => Math.round(Math.min(max, Math.max(0, Number(v))));
  if (Number.isFinite(Number(t.panelOpacity)) && t.panelOpacity !== null && t.panelOpacity !== '') out.panelOpacity = pct(t.panelOpacity, 100);
  if (Number.isFinite(Number(t.imageDim)) && t.imageDim !== null && t.imageDim !== '') out.imageDim = pct(t.imageDim, 90);
  if (Number.isFinite(Number(t.strip)) && t.strip !== null && t.strip !== '') out.strip = pct(t.strip, 400);
  if (BACKGROUNDS.includes(t.background)) out.background = t.background;
  // image is a bare file name we created ourselves (no folders), or null to remove it
  if (t.image === null) out.image = null;
  else if (typeof t.image === 'string' && /^[\w.-]+$/.test(t.image)) out.image = t.image;
  return out;
}

// Key under which an event's theme is stored. Without an event we still need somewhere to keep the choice.
const themeKey = (eventId) => eventId || '_none';

// The complete theme for an event. Older configs had only "wholeColor"; it seeds the accent so an existing
// setup keeps its colour.
function themeFor(cfg, eventId) {
  const legacy = HEX.test(cfg.wholeColor || '') ? { accent: cfg.wholeColor.toUpperCase() } : {};
  return { ...DEFAULT_THEME, ...legacy, ...cleanTheme(cfg.themes?.[themeKey(eventId)]) };
}

// What the pages receive: the theme plus a ready-to-use image URL (served by server.js under /media/).
function themeView(theme) {
  return { ...theme, imageUrl: theme.background === 'image' && theme.image ? `/media/${encodeURIComponent(theme.image)}` : null };
}

module.exports = { DEFAULT_THEME, PRESETS, cleanTheme, themeFor, themeKey, themeView };
