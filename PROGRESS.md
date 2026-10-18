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

- 2026-10-17 Public GitHub repo (CubeBender/dance-projector). Removed personal data from the tree: real fixture replaced by anonymised `sample.json`, OBS backup untracked, real judge removed from tests. Added ignore rules and a pre-commit hook (`.githooks/`, enabled with `git config core.hooksPath .githooks`).

- 2026-10-17 Git history rewritten and force-pushed without personal data (user's decision D-11). Pre-commit hook fixed (it let one commit through when its output was cut off).
- 2026-10-17 **OBS show built with placeholders**: collection "Dance Projector 2026" (14 scenes), shared background, fade/Move/Dip-to-black transitions, pause-media-off-air script (tested: pauses off air, resumes from the same frame). New app pages: schedule, lower third. Branding placeholders in `obs/pages/`. Every scene checked as rendered by OBS.
- 2026-10-17 Fixed: output pages in OBS stopped loading photos/data because of the 6-connections-per-host browser limit (pages now poll). Fixed: OBS default stylesheet and blur broke the background.

- 2026-10-18 Saved DanS servers: named list next to the address field, save / rename / delete dialog (C-17). Tests extended; checked in a separate test instance of the app.

## In progress
- Nothing running. The app is left running on the user's data; OBS is on the new collection with "99 Black" on program.

## Next
- User: look at the new collection in OBS; set up the Touch Portal page (Docs/obs-show/TOUCH_PORTAL.md).
- User: real materials (logo, colours, sponsor logos/videos) → obs/assets + obs/pages/config.js.
- Optional: ask GitHub support to purge cached old commits, or re-create the repository.
- Rehearsal with camera and a live DanS round.

## Blockers
- None. Final OBS visuals wait for the real branding materials; placeholders are in place.
