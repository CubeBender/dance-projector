# Decisions

Claude's decision log. Questions that need the user are asked in the conversation; the question and the user's answer are recorded here. Technical choices Claude makes on its own are logged as **Claude's decision** with the reason. Changed decisions keep their history.

## User decisions

### D-01 Never send anything to the federation
- **Decision:** DanS is read-only for this project. No result or report delivery, no state changes.
- **By:** user, 2026-10-17. Implemented as a GET-only allow-list in the DanS client.

### D-02 Back up the 2025 OBS setup, then remove Duel/VS scenes
- **By:** user, 2026-10-17. Done 2026-10-17 (`obs/backup-2025`, OBS collection "Zaloha 2025").

### D-03 Live feed source
- **Decision:** the Elgato capture card in the LIVE scene. **By:** user, 2026-10-17.

### D-04 "Scrutineer allocation" meaning
- **Decision:** the judges assigned to a specific competition. **By:** user, 2026-10-17.

### D-05 Build our own Electron app
- **Decision:** the app selects competitions, manages judge photos and display names, tracks running competitions and serves output pages for OBS (heats, judges, split screen). **By:** user, 2026-10-17.

### D-06 What "running" means
- **Decision:** a competition is running when judging is enabled for its round. **By:** user, 2026-10-17.
- **Verified 2026-10-17:** after the user enabled judging on competition 3, its round state changed from `Paused` to `InProgress`. The app counts `InProgress` as running.

### D-07 Language on output pages
- **Asked:** Czech, English or bilingual?
- **Answer (2026-10-17):** bilingual, with the second language as smaller text underneath, and a setting for which language is primary.

### D-08 What the heats page shows per competitor
- **Asked:** number + name + club, number + name, or numbers only?
- **Answer (2026-10-17):** build all three with a setting to choose. The user is not sure what ČSTS rules allow at championships.

### D-09 Which dance the heats page shows
- **Asked:** current dance only, current + overview, or manual choice?
- **Answer (2026-10-17):** current dance only (the first dance not yet completed).

### D-10 Judge photo crop
- **Asked:** adjustable crop per judge, or automatic?
- **Answer (2026-10-17):** adjustable crop per judge, saved with the photo.

### D-13 Three data modes and a Push step (2026-11-19)
- **Context:** after consultation, the user is wary of reading the API live for the first time at an important event; judges are drawn randomly just before each competition.
- **Decision (user):** modes Manual (operator picks the panel), On demand (fetch only when the operator presses a button) and Automatic (current polling). The projection changes only when the operator pushes a verified state; it stays until the next push.
- **Heats** are not needed for now (user).

### D-14 Manual mode data source
- **Asked:** where does the list of judges come from in manual mode – read once from DanS ahead, entered in the app, or both?
- **Answer (2026-11-19):** read the event's judge list once ahead (rehearsal) and keep it locally; manual mode on the day needs no connection.

### D-15 Colour scheme scope and background
- **Asked:** scheme per competition or per event? Background colours only, colours + image, or also video?
- **Answer (2026-11-19):** one scheme per event; background from the scheme colours with an optional image.

### D-16 Rust rewrite
- **Asked:** rewrite in Rust (Tauri) now, later, or stay with Electron?
- **Answer (2026-11-19):** stay with Electron. (Claude's assessment given in the conversation: Tauri would cut install size and memory, but costs a rewrite of the main process, makes event-day fixes slower, and webcam text recognition is harder natively; output pages stay HTML either way.)

### D-17 Reading the printed panel with the webcam
- **Context (2026-11-19):** the user asked whether the printed DanS panel list could be read from the webcam, with human review before pushing.
- **Status:** feasible (offline Tesseract + matching against the known judge list, uncertain matches flagged). Waiting for a photo/scan of a real printout before building it.

## Claude's decisions

### C-01 Technology: Electron with plain JavaScript, no framework or build step
- **Why:** few dependencies, easy to adjust on the day, nothing to compile.

### C-02 Updates from DanS by polling every 2 seconds
- **Why:** the DanS live stream uses an undocumented binary format; plain GET polling is simple and light on a LAN.

### C-03 Output server on port 8787, all network interfaces
- **Why:** OBS on the same PC uses localhost; another PC or a second OBS can also use the pages. The pages are read-only.

### C-04 Judge photos and names stored per federation ID in the app data folder
- **Why:** the same judges appear at many events; data carries over automatically.

### C-05 Two display slots, A and B, each with a floor-side label and colour
- **Why:** the floor is split at most in two; colours are editable to match the lighting. Defaults: A blue `#1E7BFF`, B red `#FF3B4E`.

### C-06 Transparent output pages
- **Why:** OBS layers them over branded backgrounds and video.

### C-07 Judge card content: photo, letter, display name; country only when not CZE
- **Why:** the letter is what the audience sees on the judges' marks; country matters only for foreign judges.

### C-08 Whole floor is the default; split floor is a switch
- **Context:** the user said (2026-10-17) the floor is split only sometimes, mainly for two small competitions.
- **Decision:** a "Floor is split in two halves" switch, off by default. Off: only slot A is used, no side label, one accent colour (default gold `#E8B931`, editable), the floor overview page shows one wide panel. On: slots A and B with side names (Czech and English) and lighting colours.
- **Why:** side labels and colours would be misleading when one competition uses the whole floor.

### C-09 Bilingual labels
- **Decision:** primary language chosen in the app (Czech or English); second language underneath at about half size, or "None". Competition titles in English are built from the ČSTS abbreviations; round names are translated ("1. kolo" → "Round 1"); text identical in both languages (like "Waltz") is shown once.

### C-10 Heats display modes
- **Decision:** a setting with three modes: number + name + club, number + name, numbers only. A page can override it with `?show=` so OBS can hold two versions.

### C-11 Photo crop
- **Decision:** crop stored as focus point (x, y in %) and zoom (1–4) per judge. Editor: drag to move, scroll or slider to zoom, inside a frame with the judge card's 3:4 shape. A new photo resets the crop.

### C-12 Keep personal data out of the public repository
- **Context:** the user pushed the repository to public GitHub (2026-10-17) and asked that personal and private data is not sent in the future.
- **Decision:** real DanS snapshots live in ignored `app/fixtures/private/`; tests and fixture mode use `app/fixtures/sample.json`, made by `npm run anonymize` (fake names, clubs, federation IDs; heats, numbers, letters and allocation unchanged). OBS backups are local only. A pre-commit hook in `.githooks/` blocks private files, e-mails, personal Windows paths, PINs and secrets.

### D-11 Rewrite public git history
- **Asked (2026-10-17):** the public GitHub history still contained the real fixture and OBS backup; rewrite + force push, push cleanup only, or leave it?
- **Answer:** rewrite history and force push. Done 2026-10-17; old file URLs return 404. GitHub may still serve old commits by their exact ID until purged (support request or re-creating the repository).

### D-12 OBS with placeholders
- **Context (2026-10-17):** the user has no logo, brand colours or sponsor materials yet, only last year's setup.
- **Decision (user):** proceed with placeholders.

### C-13 Output pages poll instead of holding a stream open
- **Decision:** pages fetch `/api/state?since=<version>` every second; 204 when unchanged; the SSE endpoint is gone (410).
- **Why:** OBS browser sources share one browser limited to 6 connections per host; open streams blocked photos and data. Found and verified in OBS on 2026-10-17. (Changes C-02's companion choice of SSE for page updates; DanS polling is unchanged.)

### C-14 OBS collection design
- **Decision:** new collection "Dance Projector 2026", numbered scene names (01–99) for Touch Portal, a shared nested "~ Background" scene under all graphics, default fade 600 ms, plus Move and Dip to black; branding in `obs/pages/config.js`; the pause script loaded with the collection.
- **Why:** consistent look and transitions without blinking backgrounds; one place to swap branding; last year's collection untouched.

### C-15 Placeholder visuals
- **Decision:** dark hall background with two drifting floor-light pools in the brand colours; logo placeholder drawn as a back-number card with the event initials; sponsor carousel on white cards; break screen with a big clock card. Default accent gold `#E8B931`, second colour blue `#1E7BFF`.
- **Why:** continues the back-number card motif of the data pages so the whole show reads as one design until real branding replaces the colours and logo.

### C-16 Judge photos re-encoded on import
- **Decision:** photos are re-encoded as baseline JPEG, max 900 px wide; originals kept in `photos-original/`.
- **Why:** smaller, uniform files for OBS. (Added while investigating a missing photo whose real cause was C-13.)

### C-17 Saved DanS servers
- **Context (2026-10-18):** the user asked to name and save the servers they connect to.
- **Decision:** a list `servers: [{ name, url }]` in the app config, shown as a dropdown beside the address field; choosing one connects at once. A dialog saves, renames, re-addresses or deletes an entry; an empty name falls back to the host. Editing the address of the connected server reconnects in the background.
- **Why:** the venue DanS address changes per event; picking by name avoids retyping IPs. The address field keeps what the operator typed until the connected server really changes (it used to be overwritten on every refresh).

### C-18 Offline copy of every read
- **Decision:** each successful DanS read is saved as `cache/<event>.json` (only when the content changed). Manual mode lists and uses these copies; the other modes show the copy at once when an event is chosen and fall back to it when DanS is unreachable.
- **Why:** implements D-14 without a separate "download" step: the rehearsal read is the copy used on the day.

### C-19 On-demand read = 3 requests
- **Decision:** the first Fetch now reads everything (as automatic mode does); later presses read only competitions, judges and the judge allocation. Heat draws are no longer read in any mode.
- **Why:** these are the only parts that change when a panel is drawn; keeps API traffic minimal (D-13).

### C-20 Hand-picked panels override DanS per competition
- **Decision:** a panel edited by hand is stored per event and competition and wins over DanS in every mode, until "Use DanS panel". The first click on a DanS panel starts from the DanS list. The window shows the difference to DanS.
- **Why:** the same review step works in all modes: correct a fetched panel or build one from scratch.

### C-21 Push covers everything on screen, style included
- **Decision:** OBS reads only the pushed state; the draft is served separately for the preview. Style changes, slot changes and the schedule also wait for Push. The window lists which parts differ. "Send every change automatically" restores the old behaviour. The pushed state is saved and restored after a restart.
- **Why:** D-13 asks that unfinished work never reaches the screen; one rule for everything is easier to trust than exceptions. Photos replaced before a push are kept until the push so the screen never shows a missing image.

### C-22 Style reaches OBS through the existing branding pages
- **Decision:** `obs/pages/brand.js` polls the app (`SHOW.app`, default `http://localhost:8787`) every 2 s for the pushed style; `background.html` shows lights, solid colour or the image. The OBS sources stay local files; `config.js` colours are the fallback when the app is not running. The server allows cross-origin reads for this.
- **Why:** no OBS source has to be rewired, and the background still works if the app is closed.

### C-23 Heats removed from use
- **Decision:** heats are no longer listed in the app, the heats setting is hidden, heat draws are not read, and the build script no longer creates "10 Heats" / "13 Heats B". The page and model code stay.
- **Why:** D-13 (heats not needed for now); keeping the code makes bringing them back cheap.

## Changes

- **2026-10-17 – how this file is used.** Before: open questions were listed here as "Pending" for the user to go through. After: questions are asked in the conversation and only recorded here. **Reason:** the user clarified the file is for Claude to keep track. Former P-03 became D-06 (verified); P-06, P-08 and P-10 were asked and became D-07–D-09 and C-07; P-01, P-02, P-04, P-05, P-07, P-09 became Claude's decisions C-01–C-06.
