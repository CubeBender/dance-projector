# OBS show

Scene collection **Dance Projector 2026**, built by `tools/build_obs_show.py`. Last year's collection ("Nepojmenované") is untouched; switch in OBS under **Scene Collection**.

## What is where

| Path | What |
|---|---|
| `pages/config.js` | **Branding: event name, logo, sponsor list, fallback colours.** Placeholders until the real materials arrive. Colours and the background come from the app's **Style** tab (per event) while the app runs. |
| `pages/*.html` | Branding pages used as local browser sources: background, logo, sponsors, break |
| `scripts/pause-media-off-air.lua` | Pauses videos when they go off air, resumes from the same frame (loaded with the collection) |
| `assets/` | Your media: logo, sponsor logos, videos (not in git) |
| `private/show.local.json` | Local paths: sponsor video, capture card (not in git) |
| `backup-2025/` | Last year's OBS configuration (not in git) |

## Scenes

| Scene | Content | Source of data |
|---|---|---|
| 01 Logo | Event / federation logo with name | `pages/logo.html` |
| 02 Sponsors | Sponsor carousel | `pages/sponsors.html` |
| 03 Sponsor video | Full-screen video, pauses off air | `show.local.json` → `sponsorVideo` |
| 04 Schedule | Running competitions first, then upcoming by check-in time | app `/out/schedule.html` |
| 11 Judges | Judges with photos, slot A | app |
| 12 Floor | Floor overview: one panel, or two halves when split | app |
| 14 Judges B | Same for slot B (split floor only) | app |
| 20 LIVE | Elgato camera | capture card |
| 21 LIVE + info | Camera with a lower third (competition, round, dance) | app |
| 30 Break | Break with clock (add `?until=14:30` to the page URL for a resume time) | `pages/break.html` |
| 99 Black | Black; dips through black | – |
| ~ Background | Shared moving background, nested in every graphics scene | `pages/background.html` |

Every graphics scene uses the same nested background, so during a transition only the content changes and the background never blinks. Default transition: fade 600 ms. Also available: **Move** (move-transition plugin) and **Dip to black**.

The app must be running for the data scenes (`cd app && npm start`).

## When the real materials arrive

1. Put files into `obs/assets/` (e.g. `logo.png`, `sponsors/partner1.png`, `promo.mp4`).
2. Edit `pages/config.js`: event name, colours, `logo: '../assets/logo.png'`, sponsor images.
3. In OBS, right-click a browser source → **Refresh** (or reload the scene collection).
4. Sponsor video: set the path in `private/show.local.json`, or change the file in the "Sponsor video" source.

## Rebuilding

```
python -I tools/build_obs_show.py --name "Dance Projector 2026 v2"   # new collection, old one stays
python -I tools/build_obs_show.py --patch-only                         # re-apply transitions, script, scene order
```

The build refuses to run while OBS is streaming or recording.
