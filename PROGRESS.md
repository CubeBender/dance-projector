# Progress

## Done
- 2026-10-17 Explored DanS. REST API needs the `dans-event` header. Judges, allocation, start list and heats are readable with GET. Findings in [DANS_KNOWLEDGEBASE.md](DANS_KNOWLEDGEBASE.md).
- 2026-10-17 Backed up the 2025 OBS setup and removed Duel/VS scenes.
- 2026-10-17 Project docs created (PROMPT, DECISIONS, SPEC, PLAN, PROGRESS, Docs/).
- 2026-10-17 **DanS client** (`app/src/main/dans.js`): GET only, allow-list of paths, PINs dropped. Snapshot fixture of Pardubice recorded.
- 2026-10-17 **Control app** (Electron): connection, event choice, competition list with running highlight, A/B slot assignment, side names and colours, follow-running option, judges editor (photo, display name), output links, settings. Tested live against DanS.
- 2026-10-17 **Output pages**: heats, judges, split. Live updates over server-sent events, transparent for OBS. Checked with screenshots against the snapshot and live DanS.
- 2026-10-17 Tests: `npm test` covers the allow-list, PIN removal, judge allocation, heats, photo storage and path-traversal guard. All pass.
- 2026-10-17 Verified: check-in times are real UTC and match the DanS Organizace page in local time.

- 2026-10-17 Verified "running" = round state `InProgress` (user enabled judging on competition 3).
- 2026-10-17 User uploaded 6 judge photos in a test instance; data moved to the normal app folder `%APPDATA%\dance-projector`.
- 2026-10-17 Added: bilingual labels with selectable main language, three heats modes, photo crop editor, whole-floor / split-floor switch. Checked with screenshots and through the real window; tests extended (English titles, floor modes, crop defaults).

- 2026-10-17 Project is a git repository (branch `main`). `.gitattributes` keeps the OBS backup byte-identical; node_modules and local settings are ignored. No remote yet.

## In progress
- Nothing running.

## Next
- OBS show: scenes with the output pages, transitions, pause-on-hide script, Touch Portal buttons. Needs logos, videos, judge photos, brand colours.

## Blockers
- None for the app. OBS visuals wait for assets.
