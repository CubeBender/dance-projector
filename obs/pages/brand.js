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
