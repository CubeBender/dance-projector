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

- 2026-11-19 **Revised workflow** (D-13 to D-16, C-18 to C-23): data modes Manual / On demand / Automatic, offline copy per event, Judge panel tab (hand-picked panels), draft vs. pushed projection with previews and Push button, style per event (colours, background lights / solid / image) used by output and branding pages, heats removed. Tests extended (`test-workflow.js`). Checked in a separate test instance on the sample event: panel edit, push, style change (draft pink, screen gold until push), on-demand failure keeps the offline data with a clear error.

- 2026-11-19 **Judge gallery** (D-18, C-24): gallery per IDT with editable names, several photos per judge, main portrait, crop per photo, folder import, New judge, filters and search. Existing 6 judges convert automatically. Tested in a separate copy of the user's data: import of `Docs/judges` added 31 photos for 17 judges, a second import skipped all 31, main photo / delete / rename / crop work. One photo file in the folder is truncated (incomplete JPEG) and cannot be imported. `Docs/judges/` git-ignored.

## In progress
- Nothing running.

## Next
- In OBS: check that the branding pages (local files) pick up the style from the app; remove the "10 Heats" and "13 Heats B" scenes from the live collection (or rebuild it).
- User: send a photo or scan of a printed DanS panel list, so webcam reading (D-17) can be built and tested.
- User: rehearsal read with On demand against the real DanS server, then try Manual mode with the offline copy.
- User: look at the new collection in OBS; set up the Touch Portal page (Docs/obs-show/TOUCH_PORTAL.md).
- User: real materials (logo, colours, sponsor logos/videos) → obs/assets + obs/pages/config.js.
- Optional: ask GitHub support to purge cached old commits, or re-create the repository.
- Rehearsal with camera and a live DanS round.

## Blockers
- None. Final OBS visuals wait for the real branding materials; placeholders are in place.
