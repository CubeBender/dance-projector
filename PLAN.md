# Plan

| # | Task | Folder | Depends on |
|---|---|---|---|
| 1 | Explore DanS and OBS | (done, findings in memory and Docs/dans-client) | – |
| 2 | DanS client | [Docs/dans-client](Docs/dans-client/PLAN.md) | 1 |
| 3 | Control app | [Docs/control-app](Docs/control-app/PLAN.md) | 2 |
| 4 | Output pages | [Docs/output-pages](Docs/output-pages/PLAN.md) | 2 |
| 5 | OBS show | [Docs/obs-show](Docs/obs-show/PLAN.md) | 4, assets from the user |
| 6 | Competitors on screen (D-22) | [Docs/competitors](Docs/competitors/PLAN.md) | 3, 4 |
| 7 | Reading DanS printouts (D-17, D-24) | [Docs/printout](Docs/printout/PLAN.md) | 6 |
| 8 | Results announcement (D-26) | [Docs/results](Docs/results/PLAN.md) | 6 |
| 9 | Heat now / next (D-29) | [Docs/heats](Docs/heats/PLAN.md) | 3 |

## Order of work

1. DanS client with a recorded snapshot of the Pardubice scouting event, so everything can be tested without a live round.
2. App skeleton: config store, polling, output server with live push.
3. Output pages: heats, judges, split.
4. Control window: connection, competition list, slots, judges editor, output links.
5. Verify against live DanS: screenshots of each page, selection flow.
6. OBS: new scene collection using the output pages, transitions, video pause-on-hide script, Touch Portal buttons. Needs the user's assets.

## Revision 2026-11-19 (D-13 to D-17)

| # | Step | State |
|---|---|---|
| 1 | Data modes manual / on demand / automatic, offline copy per event | done |
| 2 | Hand-picked judge panels (Judge panel tab) | done |
| 3 | Draft vs. pushed projection, previews, Push button | done |
| 4 | Style per event (Style tab), used by output and branding pages | done |
| 5 | Heats removed from outputs and OBS build script | done |
| 6 | Check in OBS: branding pages (local files) read the style from the app | waiting for OBS to run |
| 7 | Webcam reading of the printed panel | waiting for a sample printout |

## Competitors (2026-11-20, D-22)

| # | Step | State |
|---|---|---|
| 1 | Data, store, ČSTS client, DanS round read | done |
| 2 | Second output server (8788) and projection, `competitors.html` | done |
| 3 | Phone upload page with key and QR code | done |
| 4 | Competitors tab: screen block, list, paste, webcam, New competitor | done |
| 5 | Check with a real phone on the venue network, a real WhatsApp copy, the Logitech camera | user |
| 6 | Add the competitor page to the OBS collection | after the user's check |
