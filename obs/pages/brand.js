// Applies config.js to the page: colours as CSS variables, helpers for bilingual text and the placeholder logo.
(function () {
  const S = window.SHOW || {};
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(S.colors || {})) root.setProperty('--' + k, v);
  const [main, second] = S.languages || ['cs', 'en'];
  // ?bg=1 previews a transparent page on the show background outside OBS
  if (new URLSearchParams(location.search).has('bg')) {
    document.documentElement.style.background = `radial-gradient(ellipse at 30% 10%, color-mix(in srgb, ${S.colors?.primary || '#E8B931'} 30%, #0A0D16), #0A0D16 60%)`;
  }
  // ---- style from the app ----
  // Asks the app for the pushed state every 2 s and applies its style (theme.js in the app):
  //   --primary / --secondary / --ground   colours used by these pages
  //   data-bg on <html>                    'lights' | 'solid' | 'image' (background.html shows the matching layers)
  //   --bg-image / --bg-dim                background image and how much it is darkened
  // Pages opened from the app itself (/brand/…) ask their own server; local files in OBS ask SHOW.app.
  // ?view=draft shows the style being prepared (the app's preview uses it).
  const params = new URLSearchParams(location.search);
  const base = location.protocol.startsWith('http') ? '' : (S.app || 'http://localhost:8787');
  const view = params.get('view') === 'draft' ? 'draft' : 'live';
  let version = 0;
  function applyTheme(t) {
    if (!t) return;
    root.setProperty('--primary', t.accent);
    root.setProperty('--secondary', t.secondary);
    root.setProperty('--ground', t.ground);
    document.documentElement.dataset.bg = t.imageUrl ? 'image' : (t.background === 'solid' ? 'solid' : 'lights');
    root.setProperty('--bg-image', t.imageUrl ? `url("${base}${t.imageUrl}")` : 'none');
    root.setProperty('--bg-dim', String((t.imageDim ?? 40) / 100));
  }
  async function pollTheme() {
    try {
      const r = await fetch(`${base}/api/state?view=${view}&since=${version}`, { cache: 'no-store' });
      if (r.status === 200) { const s = await r.json(); version = s.version || 0; applyTheme(s.theme); }
    } catch { /* app not running: keep the colours from config.js */ }
    setTimeout(pollTheme, 2000);
  }
  pollTheme();

  window.BRAND = {
    S, main, second,
    // text in main language with the second language underneath
    bi(obj) {
      const a = obj?.[main] ?? '', b = second ? obj?.[second] : null;
      return b && b !== a ? `${esc(a)}<span class="second">${esc(b)}</span>` : esc(a);
    },
    // Placeholder logo: a white back-number style card with the initials of the event, in an outlined frame.
    logoHtml(size = 420) {
      if (S.logo) return `<img src="${S.logo}" alt="" style="max-width:${size * 1.8}px;max-height:${size}px;object-fit:contain">`;
      const initials = (S.event?.name || 'LOGO').split(/\s+/).filter((w) => /^[A-ZÁ-Ž]/.test(w)).slice(0, 3).map((w) => w[0]).join('') || 'LOGO';
      return `<svg width="${size}" height="${size}" viewBox="0 0 420 420" aria-hidden="true">
        <rect x="10" y="10" width="400" height="400" rx="48" fill="none" stroke="var(--primary)" stroke-width="6" stroke-dasharray="18 14"/>
        <rect x="80" y="110" width="260" height="200" rx="20" fill="#fff"/>
        <rect x="80" y="110" width="260" height="18" rx="9" fill="var(--primary)"/>
        <text x="210" y="262" text-anchor="middle" font-family="Bahnschrift, Arial Narrow, sans-serif" font-weight="700" font-size="112" fill="#0B0D12">${esc(initials)}</text>
        <text x="210" y="372" text-anchor="middle" font-family="Bahnschrift, sans-serif" font-size="26" letter-spacing="6" fill="var(--muted)">LOGO</text>
      </svg>`;
    },
  };
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
})();
