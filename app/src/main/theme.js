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
  panelOpacity: 80,     // 0–100 %, how solid those plates are
  background: 'lights', // 'lights' (moving light pools) | 'solid' (ground colour only) | 'image'
  image: null,          // file name in <userData>/media, used when background === 'image'
  imageDim: 40,         // 0–90 %, darkens the image so text stays readable
};

const HEX = /^#[0-9a-f]{6}$/i;
const BACKGROUNDS = ['lights', 'solid', 'image'];

// Keeps only known fields with valid values. Used both for stored themes and for patches from the window,
// so a bad value can never reach the pages.
function cleanTheme(t = {}) {
  const out = {};
  for (const k of ['accent', 'secondary', 'ground', 'panel']) if (HEX.test(t[k] || '')) out[k] = t[k].toUpperCase();
  const pct = (v, max) => Math.round(Math.min(max, Math.max(0, Number(v))));
  if (Number.isFinite(Number(t.panelOpacity)) && t.panelOpacity !== null && t.panelOpacity !== '') out.panelOpacity = pct(t.panelOpacity, 100);
  if (Number.isFinite(Number(t.imageDim)) && t.imageDim !== null && t.imageDim !== '') out.imageDim = pct(t.imageDim, 90);
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

module.exports = { DEFAULT_THEME, cleanTheme, themeFor, themeKey, themeView };
