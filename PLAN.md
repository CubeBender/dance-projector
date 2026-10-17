# Plan

| # | Task | Folder | Depends on |
|---|---|---|---|
| 1 | Explore DanS and OBS | (done, findings in memory and Docs/dans-client) | – |
| 2 | DanS client | [Docs/dans-client](Docs/dans-client/PLAN.md) | 1 |
| 3 | Control app | [Docs/control-app](Docs/control-app/PLAN.md) | 2 |
| 4 | Output pages | [Docs/output-pages](Docs/output-pages/PLAN.md) | 2 |
| 5 | OBS show | [Docs/obs-show](Docs/obs-show/PLAN.md) | 4, assets from the user |

## Order of work

1. DanS client with a recorded snapshot of the Pardubice scouting event, so everything can be tested without a live round.
2. App skeleton: config store, polling, output server with live push.
3. Output pages: heats, judges, split.
4. Control window: connection, competition list, slots, judges editor, output links.
5. Verify against live DanS: screenshots of each page, selection flow.
6. OBS: new scene collection using the output pages, transitions, video pause-on-hide script, Touch Portal buttons. Needs the user's assets.
