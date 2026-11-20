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
- 2026-11-19 **Photo fixes** (C-25): photos with an EXIF orientation tag no longer appear rotated; the truncated JPEG now imports (practically complete); ↺ / ↻ buttons in Adjust photo. Checked on a copy of the user's current data: Import folder… again redid 31 photos (the two sideways ones now upright), added the missing one, failed none; a further import skipped all 32; rotate right gives 1200×900, back gives 900×1200.

- 2026-11-19 **Own selection and Delete judge** (D-19, C-26): Judge selection tab with From DanS / Own selection per side; own selection works with no DanS data and no event (gallery judges, editable letters, optional number/title/round). Delete judge… with a confirmation window. Judge cards keep double surnames together. Checked in an empty test instance with made-up judges: select, letters, push, rendered page with and without number/title, delete with Cancel and with Delete.

- 2026-11-19 **Output look for MČR** (D-20, C-27 to C-29): Transparent background type (Background page empty, checkerboard in the app's previews), MČR SÓLO 2026 style preset, text colour, colours derived from the style, no letters on judge cards, judge order per side (surname / first name / letter / custom with ↑ ↓), larger themed header. Tests extended (sort modes, Czech alphabet, custom order). Checked: judges and floor pages rendered with the MČR style; in a separate test instance with the sample event: First name order, ↓ switched to Custom and the prepared preview followed, preset applied, transparent preview.

- 2026-11-19 **Judge cards fill the middle** (D-21, C-30): sponsor strip margin in the style (MČR 120 px + 24 px buffer, header 24 px from the top), cards sized from the measured free area, even rows, taller photos and bigger names when a single row leaves height free. Checked with 4, 9 and 14 judges in the MČR style with the strip area marked.

- 2026-11-20 **Competitors on screen** (D-22, C-31 to C-36): Competitors tab, `competitors.json` per event, own output server on port 8788 with its own Push, `/out/competitors.html` (whole round / spotlight), phone upload page (`/upload?key=…`, QR code, off by default), Ctrl+V paste, drag and drop, file picker, webcam (prefers Logitech), ČSTS lookup by IDT (`/api/members/{IDT}`, no login). Tests: `scripts/test-competitors.js` (in `npm test`). Checked in a test instance: screenshots of solo, couples and spotlight; load round from the fixture; push; phone upload to the LAN address (known / unknown number / not an image); photo bytes over IPC; crop; rotate; live ČSTS lookup; the app sees the Logitech StreamCam.

- 2026-11-20 **Competitors without start numbers** (D-23, C-37, C-38): checked the report of "numbers assigned on fetch" – none were; the app was on the old Pardubice event. Competitors are now identified by DanS entry, numbers only from DanS, Refresh start list button, filter No number yet, typed competitors with optional number, phone/pasted photos for an unknown number move onto the DanS competitor once numbered, photos shown across the Saturday/Sunday events by IDT. Tests extended; checked against the local DanS on CS1747: 283 competitors, 0 numbers shown, DanS numbers can't be typed.

## In progress
- Nothing running.

## Next
- User: try the Competitors tab with real data – Load from DanS round in On demand mode, Ctrl+V from WhatsApp Desktop, the webcam, and the phone upload page from the organizer's phone on the venue Wi-Fi (Windows may ask about the firewall for port 8788: allow private networks).
- Add the competitor page (`http://<pc>:8788/out/competitors.html`) as a browser source in the OBS collection.
- In OBS: check that the branding pages (local files) pick up the style from the app; remove the "10 Heats" and "13 Heats B" scenes from the live collection (or rebuild it).
- User: send a photo or scan of a printed DanS panel list, so webcam reading (D-17) can be built and tested.
- User: rehearsal read with On demand against the real DanS server, then try Manual mode with the offline copy.
- User: look at the new collection in OBS; set up the Touch Portal page (Docs/obs-show/TOUCH_PORTAL.md).
- User: real materials (logo, colours, sponsor logos/videos) → obs/assets + obs/pages/config.js.
- Optional: ask GitHub support to purge cached old commits, or re-create the repository.
- Rehearsal with camera and a live DanS round.

## Blockers
- None. Final OBS visuals wait for the real branding materials; placeholders are in place.
