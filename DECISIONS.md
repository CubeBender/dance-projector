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

## Changes

- **2026-10-17 – how this file is used.** Before: open questions were listed here as "Pending" for the user to go through. After: questions are asked in the conversation and only recorded here. **Reason:** the user clarified the file is for Claude to keep track. Former P-03 became D-06 (verified); P-06, P-08 and P-10 were asked and became D-07–D-09 and C-07; P-01, P-02, P-04, P-05, P-07, P-09 became Claude's decisions C-01–C-06.
