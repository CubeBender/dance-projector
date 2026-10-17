// ---------------------------------------------------------------------------
// Show branding. PLACEHOLDERS until the real materials arrive.
// Edit this file, then refresh the browser sources in OBS (or re-run tools/build_obs_show.py).
// Media files go to obs/assets/ (not committed to git).
// ---------------------------------------------------------------------------
window.SHOW = {
  event: {
    name: 'Název soutěže 2026',          // placeholder
    nameEn: 'Competition name 2026',
    place: 'Město · Hala',
    date: '17. 10. 2026',
  },
  colors: {
    primary: '#E8B931',   // placeholder accent (gold); replace with brand colour
    secondary: '#1E7BFF', // second brand colour
    ground: '#0A0D16',    // background base
  },
  // Federation / event logo. null = drawn placeholder. Example: '../assets/logo.png'
  logo: null,
  // Sponsors for sponsors.html. Each: { name, image (or null for placeholder), seconds }
  sponsors: [
    { name: 'Hlavní partner', image: null, seconds: 8 },
    { name: 'Partner 2', image: null, seconds: 6 },
    { name: 'Partner 3', image: null, seconds: 6 },
    { name: 'Partner 4', image: null, seconds: 6 },
  ],
  breakText: { cs: 'Přestávka', en: 'Break' },
  languages: ['cs', 'en'], // main, second (or just ['cs'])
};
