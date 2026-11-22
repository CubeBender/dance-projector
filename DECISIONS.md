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

### D-18 Judge gallery
- **Decision (user, 2026-11-19):** keep a gallery of judges inside the app, identified by IDT, with editable name and surname, all photos a judge sent, and a chosen main portrait that can be changed later. Photos come from `Docs/judges`, named `IDT_Surname_Name[ Number]`.
- **Also (user):** comment the code more, the user reviews it.


### D-19 Judge selection without DanS; deleting judges
- **Asked by the user (2026-11-19):** show a judge selection even without a connection to DanS, using the judge gallery and a judge selection page; allow deleting judges from the gallery with a confirmation window.
- **Decision:** the Judge panel tab becomes **Judge selection**. Each screen side chooses **From DanS** (as before) or **Own selection**: judges picked from the gallery with letters A, B, C… given automatically and editable, plus an optional competition number, title (two languages) and round typed by hand. It needs no DanS data and no event, and goes through Push like everything else. **Delete judge…** on gallery cards asks in a window that lists what is removed.
- **Changes D-14:** manual work no longer depends on a judge list read from DanS ahead; the gallery is enough.

### D-20 Output look for MČR SÓLO (2026-11-19)
- **Asked by the user:** transparent background so the background is added in OBS; colours from the MČR event (primary #BD9C66, secondary #1F1917, from `OBS_transition/CLAUDE.md`); no letters on the judge cards; choose how judges are sorted (custom, by surname, …); bigger header in the theme colours.
- **Decision:** see C-27 to C-29. The output pages were already transparent (only the plates behind text are drawn); the new **Transparent** background type also empties the Background page.
- **Changes D-15:** a fourth background type (none), a text colour in the style, and ready-made event styles.

### D-21 Judge cards fill the free middle; room for the sponsor strip (2026-11-19)
- **Asked by the user:** cards about 20 % bigger. Claude pointed out that 9 judges in one row already use the full width. User's answer: scale the cards dynamically by the number of judges and the space available; keep the bottom 120 px (OBS sponsor strip) plus a small buffer clear; the header mirrors that at the top; the judges fill the middle.
- **Decision:** see C-30.

### D-22 Competitors in semifinals and finals (2026-11-20)
- **Asked by the user:** show photos and names of the competitors in semifinals and finals, like the judges. Solo: photo, full name, number. Couple: photo, both surnames, number. Own tab in the app; own projection, possibly on its own port. Competitors from DanS, typed by hand, or looked up at ČSTS by IDT. Photos by drag and drop, file picker, WhatsApp (automatically if possible) or the Logitech webcam.
- **Asked: how do photos get from the organizer into the app?** Claude explained that WhatsApp cannot be watched officially (WhatsApp Desktop saves nothing to a folder by itself, file names carry no start number), and that a bot on WhatsApp Web breaks WhatsApp's terms and risks a ban of the user's number. **Answer:** paste (Ctrl+V) or drag from WhatsApp Desktop, **plus a phone upload page** served by the app: the organizer scans a QR code, takes the photo, types the number, and it lands on that competitor.
- **Asked: what does the competitor projection show?** **Answer:** the whole round at once (like the judge panel) **and** a single-competitor spotlight.
- **Asked: how does the app know who dances in the round?** **Answer:** from the DanS round (fetched on demand) or numbers typed by hand; reviewed, then pushed.
- **ČSTS credentials (user, 2026-11-20):** the user offered their ČSTS account in case the API needs a login. Not needed: the public member lookup answers without one (C-33). Revisit only if ČSTS closes it.

### D-23 Start numbers only from DanS; two events, two days (2026-11-20)
- **Reported by the user:** after fetching from DanS, competitors showed start numbers although none were given yet; real numbers are given later by competition staff in DanS, so the app must not show a number DanS doesn't have.
- **What Claude found:** neither DanS nor the app had made numbers. The app was still on the old Pardubice event (CS1761, 2026-10-17), whose 16 numbered competitors were checked in back then (same numbers as in the October snapshot). The new event CS1747 has 283 competitors and no numbers. The real problem was the opposite: the app identified competitors by number only, so it would have listed none of them and nothing could be prepared ahead.
- **Decision:** competitors are identified by their DanS entry (C-37); a number is shown only when DanS has one; **Refresh start list** picks numbers up later.
- **Also told by the user:** the championship is two DanS events – Saturday: Mistrovství ČR v latinskoamerických tancích sólo; Sunday: Mistrovství ČR ve standardních tancích sólo + vyhlášení MČR 10T sólo – and a competitor's number can differ between the days. **Decision:** photos follow the dancer between the two events by IDT (C-38).

### D-24 Reading DanS printouts at the MČR (2026-11-20)
- **Asked by the user:** on both days there will probably be no connection to the DanS running the event, only the offline copy; the running competition, its judges and the competitors of each round arrive on DanS printouts. Hold the paper at the webcam and let the app read it. No printout yet – prepare as much as possible; C:\DanS may be inspected.
- **What Claude found:** DanS can print `startlist`, `judges-comp`, `advancing`, `eliminated`, `heats-by-competitors`, `heats-by-heats`, `schedule`, `results`, `final` and more (report names inside `sart.exe`). Earlier prints are kept in `%LOCALAPPDATA%\dans`; one is a **round start list**, which carries competition number, title and round, the competitors with start numbers, and the judge panel ("Porota" with letters) on one sheet.
- **Decision:** build reading for that sheet (and any sheet with the same kinds of lines): see C-39 to C-41 and [Docs/printout](Docs/printout/SPEC.md). Review before applying, as asked in D-17.
- **Changes D-17:** no longer waiting for a sample – built from DanS's own earlier print; to be checked with a real paper sheet and the Logitech.

### D-25 Fetch and pick the competition inside Judge selection (2026-11-21)
- **Asked by the user:** try showing the judges straight from DanS: in Judge selection, choose From DanS, fetch, pick the competition, and its judge panel is selected. The Saturday event (CS1747) has two competitions with a panel drawn.
- **Decision:** see C-43. Changes D-24 for today only in that DanS is reachable over the venue network after all; printouts stay the fallback.

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

### C-24 Gallery details
- **Decision:** IDT = the federation id DanS gives as `in_authority_id` (same 8-digit numbers). Crop per photo. Import skips files already imported (SHA-1 of the original), keeps names already in the gallery, and reports unrecognised or unreadable files. Gallery names win over DanS on screen. Delete asks with a second click on the photo instead of a dialog. `Docs/judges/` is git-ignored and blocked by the pre-commit hook.
- **Why:** re-importing the folder after adding photos must be safe; the operator's corrections must survive; photos of real people must never reach the public repository.

### C-25 Images decoded by Chromium, rotate buttons
- **Context (2026-11-19):** the user reported photos shown rotated and one photo that would not import. Cause: phone photos stored sideways with an EXIF orientation tag (Electron's nativeImage ignores it), and one JPEG missing its last bytes (nativeImage refuses it).
- **Decision:** all images are re-encoded by Chromium's decoder in a hidden window (`imagedecode.js`), which applies EXIF orientation; a JPEG without its end marker gets one appended on a temporary copy, so the data that is there decodes. Photos made this way carry `enc: 2`; importing the same folder again redoes older photos from their originals (keeping place, main status and crop). The Adjust photo window also has ↺ / ↻ buttons that write a turned copy and reset the framing. (The user asked for either a fix or a rotate option; both were done.)
- **Why:** fixes existing galleries with one click on Import folder…, and still lets the operator correct any photo whose orientation tag is wrong.

### C-26 Own selection details
- **Decision:** stored in config (`slots.X.source`, `manualPanels.X = { number, title, titleEn, round, judges: [{ fedId, letter }] }`), not per event, because it is independent of DanS. Pressing Show on a DanS competition switches that side back to DanS; "follow running" never replaces an own selection. Letters are cleaned to A–Z/0–9, max 3; a duplicate letter is pointed out. On screen the header shows only what was typed and disappears when nothing was. Judge cards now take first name / surname from the gallery fields (so double surnames stay together) unless a name on screen is typed. Deleting a judge also removes them from own selections; their photo files stay until the next push.
- **Why:** works on the event day with DanS unreachable, with the same review-and-push routine.

## Changes

- **2026-10-17 – how this file is used.** Before: open questions were listed here as "Pending" for the user to go through. After: questions are asked in the conversation and only recorded here. **Reason:** the user clarified the file is for Claude to keep track. Former P-03 became D-06 (verified); P-06, P-08 and P-10 were asked and became D-07–D-09 and C-07; P-01, P-02, P-04, P-05, P-07, P-09 became Claude's decisions C-01–C-06.

### C-27 MČR style as a preset
- **Decision:** the Style tab gets an **Event colours** row with a one-click preset "MČR SÓLO 2026": accent #BD9C66, panels and background #1F1917, text and second colour #E8D6A6 (the cream of the event poster), panel opacity 88 %, background Transparent. It is applied to the current event's style like any manual edit (and goes out with Push). New style field `text`; the quieter text colour, plate edge, number card and ink on coloured fills are derived from the style in `common.js` instead of fixed blue-grey/white values.
- **Why:** the style is per event already (D-15), so a preset avoids typing hex codes on the day and keeps other events unchanged. Cream text instead of white matches the event's own materials. Deriving the secondary colours keeps every page readable for any accent (dark ink on light accents like gold, white on dark ones).

### C-28 Judge order on screen
- **Decision:** per screen side (`slots.X.judgeSort`): **Surname** (default), **First name**, **Letter (DanS order)**, **Custom**. Sorting uses the Czech collation (Č after C, CH after H). Custom order is a list of IDTs (`slots.X.order`) changed with ↑ / ↓; pressing an arrow switches the side to Custom, starting from the order shown at that moment. Judges not in the list go last by surname. Works for DanS panels and own selections; the Judge selection tab shows the panel in screen order. Letters stay in the app (DanS letter, own-selection letter) because Letter order uses them.
- **Why:** with letters gone from the cards, letter order looks random to the audience; surname is the usual order for printed panels. A per-side list of IDTs is simple and survives switching competitions (unknown IDTs are ignored).

### C-29 Header and judge cards
- **Decision:** header about 35 % larger (number card 132 px, title 76 px, round 36 px in the accent colour, side chip 30 px), 14 px side bar and a thin accent line at the bottom. Number cards are drawn in the accent colour with dark ink (formerly white). Judge cards: no letter; a thin accent line between photo and name; "Judges · n" in the accent colour. The card grid leaves room for the taller header.
- **Why:** the user's request; the accent card ties the header to the event colours while staying the "back-number" signature of the design.

### C-30 Card fitting and strip margin
- **Decision:** style field `strip` (px, per event, 0 = none; MČR preset 120). The pages keep strip + 24 px free at the bottom and 24 px at the top (without a strip: 56 px both, as before); applies to judges, floor overview, schedule, heats and lower third. The judges page measures the real free area and tries every number of rows with the judges spread evenly (14 = 7 + 7), keeping the layout with the widest cards (max 440 px); a shorter last row is centred. When the width is the limit (a long single row), spare height goes 60 % into a taller photo (up to 5:8) and 40 % into bigger name text (up to 1.35×); the text steps back down if a surname would be cut.
- **Why:** measuring instead of estimating keeps it right when the header, languages or strip change. Taller photos and bigger names use the space a single row leaves, which is where the "20 % bigger" can actually come from. Checked: 4 judges ≈ 305 px wide, 9 ≈ 179 px with taller photos and larger names, 14 in two rows of 7, all clear of the strip.

### C-31 Competitor list per event, keyed by start number
- **Decision:** `competitors.json` in the app data folder, `{ "<event key>": { "<number>": entry } }`, event key as for styles (`_none` without an event). Entry: `kind` solo/couple, `people[{ name, surname, idt }]`, `club`, `photos[{ file, hash, crop }]`, `main` (same photo shape as the judge gallery, so the crop editor and rotate buttons work unchanged). DanS start-list entries are shown merged with it; anything typed in the app wins over DanS, like judge names.
- **Why:** start numbers belong to one event, and the organizer refers to competitors by number. Keeping photos per event avoids a 2025 photo showing up at a 2026 event under the same number.

### C-32 Own port and own Push for competitors
- **Decision:** a second output server on port **8788** (`competitorPort`) serves `/out/competitors.html` and its own `/api/state`. It has its own draft / pushed pair (`pushed-competitors.json`) and its own **Push competitors** button; "send every change automatically" covers both. Judges stay on 8787, unchanged.
- **Why:** the user asked for a port per projection. A separate push keeps a half-prepared final from leaving with a judge panel push, and the other way round.

### C-33 ČSTS lookup by IDT
- **Decision:** `GET https://www.csts.cz/api/members/{IDT}` (public, no login) gives `name`, `surname`, `clubName`. Fallback `GET /api/1/athletes/{IDT}` (one `name` string, "Surname Name"). One request at a time, only when the operator presses Find, answers kept for the session. ČSTS answers `429` when asked too often; the app then says to wait a minute. Only the IDT is sent.
- **Why:** checked on 2026-11-20 against the live site; the members endpoint has the fields split, so double surnames need no guessing.

### C-34 Phone upload page
- **Decision:** off by default. When switched on in the Competitors tab, the competitor server (8788) also serves `/upload?key=<random>` with a QR code in the app. The page opens the phone camera (`capture`), asks for the start number, shows who that is, shrinks the photo on the phone and posts it. Requests without the right key are refused; the key changes with **New link**; only images up to 20 MB. A photo for an unknown number creates a competitor with just that number (flagged in the list). Every received photo is re-encoded like judge photos and becomes that competitor's main photo; the window shows a notice.
- **Why:** this is the "automatic by number" the user wanted without touching WhatsApp. The key keeps other people on the venue Wi-Fi from posting or reading names. Phone and laptop must share a network (venue Wi-Fi or the laptop's hotspot).

### C-35 Paste, drag and webcam
- **Decision:** Ctrl+V on the Competitors tab takes an image from the clipboard (WhatsApp Desktop: right-click → Copy). It goes to the selected competitor; with none selected a small window asks for the number. Dropped files work on any competitor card. Images travel to the main process as bytes (clipboard images have no file path) and are re-encoded like judge photos. **Webcam…** opens a live view, prefers a camera whose name contains "Logitech", remembers the choice, and takes the photo with one click.
- **Why:** one path for every source; Ctrl+V is the fastest WhatsApp route that is reliable.

### C-36 What the competitor screen shows
- **Decision:** `competitorScreen` in config: header (competition from DanS or typed number / title / round), `numbers` in the round, `mode` round / spotlight, `spotlight` number. **Load from DanS round** reads the start list and the draw of the competition's current round (2 GET requests, also in On demand mode; never in Manual mode, which uses the offline copy). The numbers stay editable. Cards are sorted by start number, the number drawn as the back-number card on the photo. Solo: first name small, surname large. Couple: both surnames ("Novák – Dvořáková"). Couple photos are framed square, solo photos 3:4. Spotlight: one large card.
- **Why:** a stored list of numbers is the same whether it came from DanS or was typed, so Manual mode and DanS mode share one path, and the operator can correct a list before pushing.

### C-37 Competitors identified by DanS entry, not by start number (changes C-31)
- **Decision:** stored entries are keyed `dans:<start-list id>` (DanS competitors) or `m:<random>` (typed in the app, or created by a photo for a number nobody has). A DanS competitor's number comes only from DanS (start list, or DanS's round draw) and cannot be typed; a typed competitor's number is typed and optional. The round, the phone page and "Photo for which number?" still work by number and look the competitor up (a DanS competitor wins over a typed one with the same number; the list marks a shared number). A typed entry that only exists because of a number (phone or pasted photo, no names typed) moves onto the DanS competitor once DanS gives that number. Entries saved by number before this change become typed entries on load and move the same way. **Refresh start list** (1 GET) reads the start list again, because Fetch now reads it only on the first read. Competitors without a number are listed after the numbered ones, by surname; a filter **No number yet** shows them.
- **Why:** the operator prepares photos and names while competitors are registered but not numbered (D-23). The DanS start-list id stays the same within an event when staff give the number, so nothing prepared is lost.
- **Changes C-31:** keyed by start number before; the reason given there (the organizer refers to numbers) still holds for lookups, not for storage.

### C-38 Photos follow the dancer to the other day's event, by IDT
- **Decision:** when a photo is added, the competitor's IDTs are noted on its stored entry (IDTs only, no names). A competitor without a photo of its own shows the photo of an entry in another event with exactly the same IDTs (one for solo, both for a couple), marked "Photo from <event>" in the window and dimmed; it is not copied and cannot be edited there. Adding a photo in the event gives it its own photo, which then wins (e.g. a Standard costume on Sunday).
- **Why:** Saturday and Sunday are separate DanS events with different ids and different start numbers (D-23); the IDT is the only thing that stays. Showing instead of copying keeps one source of truth and costs nothing if Sunday gets new photos.

### C-39 Text recognition: Tesseract in the app, offline, two readings per photo
- **Decision:** tesseract.js 7 with the Czech `best_int` data from `@tesseract.js-data/ces` (both npm packages, pinned), run in the main process, started on first use and stopped after two idle minutes. Each photo is read twice – prepared (enlarged ×2, grey, light divided by a heavily blurred copy, in the hidden Chromium window) and as taken – and the readings are combined, a sure reading winning over an unsure one.
- **Why:** works with no internet at the venue; no Windows language packs needed. On a real DanS sheet a whole-A4 webcam frame was unreadable in places as taken but readable prepared, and the other way round for single rows; combined, all competitors and judges were found. About 2–3 s per photo.

### C-40 Matching by known names, not by layout
- **Decision:** the parser (`printout.js`) looks for every known competitor (offline start list, typed ones) and judge (event list, gallery) in the recognised lines with a forgiving comparison, takes the start number just before a competitor's name, and reads the header by competition number + title. Sure = score ≥ 0.82 and clearly ahead of the next candidate (number not used twice); everything else is marked for checking. Couples must be on one line (or the next line without a number); the "Porota" lines are skipped for competitors; a solo competition drops couple matches.
- **Why:** recognition errors and desk junk break any layout-based reading, but a name that is 85 % right still points at exactly one known person. Known lists exist offline (start list, judges, gallery).

### C-41 Applying a printout
- **Decision:** after review, **Apply** fills the competitor screen (competition, round name, numbers) and the **own selection** of side A (B on a split floor) with the judges, letters and header. A start number read from the sheet is stored on the DanS competitor as `printNumber` and wins over the offline copy (shown as "number from printout"); a number given before to someone else is taken back. The phone page gets a **Printout** mode that sends a photo of the sheet (2400 px); the review window then opens in the app.
- **Why:** the printout is DanS's newest word on the day, newer than the offline copy (consistent with D-23: numbers only from DanS). An own selection needs no DanS data, so the judge panel works offline. A phone photo has far more pixels than a 1080p webcam for small print.

### C-42 Printout camera on its side: find the way up automatically (2026-11-21)
- **Reported by the user:** with the webcam turned vertical (to fit the whole page), reading a "Soutěžní listina" found 0 judges and 0 competitors.
- **Decision:** a camera frame is read first turned by the remembered amount (`printoutRotate` in config). If that finds fewer than two known things and Tesseract's confidence is below 65 %, the other quarter turns are tried (90°, 270°, 180°) and the best wins (most known things, then confidence) and is remembered, so the next read is quick. Photos from a file, Ctrl+V or the phone start upright and do not change the camera's turn. The window shows the live picture turned the same way and has a **↻ Turn** button to set it by hand.
- **Why:** Tesseract reads only upright text; text on its side gives junk with low confidence, so the comparison is clear. A camera on its side puts more pixels on an A4 page: on simulated frames of the real start list the sideways page read better (3/3 competitors and 7/7 judges, all sure, all letters) than the whole page upright. The first sideways read takes 8–11 s, then about 5 s.

### C-43 From DanS side gets its own Fetch and competition list (2026-11-21)
- **Decision (Claude):** the From DanS block of each side starts with a bar: a **Fetch from DanS** button (the same 3-request read as Fetch now in the top bar, sharing its busy state) with the time of the data, and a **Competition** list of the event's competitions with round and judge count ("9 judges" / "no panel yet"). Choosing one does what Show / A / B does in Competitions (`assign`), so both places stay in step; "– choose –" takes it off the side. In Manual mode the bar does not fetch but offers **Switch to On demand**; in Automatic mode it only says data comes by itself; with no event chosen it points at the top bar.
- **Why:** reuses the existing read and the existing slot assignment, so no new DanS paths and nothing new to keep in sync. The judge count tells at a glance which competitions already have a drawn panel. Manual mode promises zero DanS contact, so it needs a deliberate switch.
- **Checked:** against the venue DanS (GET only) on CS1747 in a separate test instance: Fetch from DanS read the data, the list showed competitions 2 and 4 with 9 judges and 1, 3, 5 with no panel; choosing 2 showed the 9 judges as "Panel from DanS" in the prepared preview. `npm test` passes.

### C-44 Header card is a style setting (2026-11-21)
- **Asked by the user:** make the card with competition number, title and round above "Porota" / "Soutěžící" optional, with a checkbox.
- **Decision (Claude):** one checkbox **Competition header card** in the Style tab, stored per event as `theme.header` (default on). The pages' shared `header()` returns nothing when it is off, so judges, competitors (and heats) follow together; the cards are measured again and grow into the freed height. Being part of the style, it reaches the screen with the next push of each projection.
- **Why:** the style already travels to both output servers and is per event, so no new plumbing; one switch keeps the two screens consistent.
- **Checked:** in a test instance: unchecking marks Style as not on screen yet, both draft states carry `header: false`, the judges page shows Porota at the top with 9 bigger cards. `npm test` passes.

### C-45 Separate header switches for judges and competitors (2026-11-21, changes C-44)
- **Asked by the user:** one checkbox for the judges page and one for the competitors page instead of the shared one.
- **Decision (Claude):** `theme.header` replaced by `headerJudges` and `headerCompetitors` (both default on). The competitor page reads `headerCompetitors`; every other page (judges, heats) reads `headerJudges`. A style saved with the old single `header` keeps its value for both.
- **Checked:** in a test instance: an old `header: false` showed as both unticked; ticking judges only gave `true / false` in both draft states, the judges page drew its card, the competitor page's `header()` returned nothing. `npm test` passes.

### C-46 Follow running reacts only to a competition that has just started (2026-11-21)
- **Reported by the user:** in Judge selection the side stayed on competition 2 whatever was picked.
- **Cause:** side A had Follow running on and competition 2's round was InProgress. Follow checked all running competitions on every rebuild, so a hand-picked competition that was not running was replaced straight back.
- **Decision (Claude):** follow only acts on competitions that started running since the last rebuild (all running ones after an event change or app start). A hand-picked competition stays until another competition starts.
- **Checked:** against the venue DanS with competition 2 running: after the first fetch, follow chose 2; picking 4 stayed on 4, also after another fetch. `npm test` passes.

### C-47 Hand-edited panels are kept per round (2026-11-21, changes C-20)
- **Reported by the user:** competition 2 showed "no panel yet" for its 3rd round although DanS had drawn 9 judges.
- **Cause:** Clear had been pressed on competition 2 earlier; the empty hand-picked panel was stored per competition, so it hid the DanS panel of every later round. DanS also drew a slightly different panel for round 3.
- **Asked by the user:** make the hand-edited panel per round.
- **Decision (Claude):** overrides in `panels.json` are keyed `round:<round id>` (the competition id only while a competition has no round). Old competition-keyed entries therefore apply only to competitions without rounds. Use DanS panel / Clear / clicking a judge act on the competition's current round.
- **Checked:** `npm test` (new asserts: old and other-round keys leave the DanS panel alone). In a test instance against the venue DanS: competition 2 round 3 showed its 9 DanS judges; removing one stored an 8-judge override under the round key and showed "differs from DanS (+0 / −1)".

### C-48 Sorting of the Competitions tab (2026-11-22)
- **Asked by the user:** sort the Competitions screen by check-in end, because the competition numbers are not always in the day's order.
- **Decision (Claude):** two chips, Sort by *Number* (the old order, default) and *Check-in end* (earliest first). Running competitions stay on top in both, as before. Competitions without a check-in end go last; ties fall back to the number. The choice is kept in the window's localStorage (a per-window convenience, not app settings).
- **Checked:** the sort on the sample event gives check-in order 08:15, 08:20, 08:25…; a competition without a time ends last. `npm test` passes.
