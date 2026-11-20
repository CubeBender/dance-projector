# Competitors on screen – specification

Request: PROMPT.md §9 and §10. Decisions: D-22, D-23, C-31 to C-38 in DECISIONS.md.

## Purpose
Show the photos, names and start numbers of the competitors of a semifinal or final on the projection, prepared and pushed the same way as the judge panel, on its own port.

## Data
- **Competitor** (per event): solo (one person) or couple (two people). Each person: name, surname, IDT. Optional club. Photos: several, one main, crop per photo.
- **Identity (C-37):** `dans:<start-list id>` for DanS competitors, `m:<id>` for typed ones. The **start number is shown only when DanS has one** (D-23) – competitors are registered long before staff give numbers. A typed competitor's number is typed (optional).
- **Two-day championship (C-38):** each day is its own DanS event with its own numbers. A competitor without a photo of its own shows the photo the same IDT(s) have in the other event, until a photo is added.
- **Sources** (merged, typed values win):
  - DanS start list (`/events/{e}/startlist`): number (null until given), `people.Persons[]` (solo) or `people.Couples[].partner1/partner2` (couple), IDTs in `in_authority_id.id`, club. **Refresh start list** reads it again (1 GET) to pick up numbers.
  - Typed in the app (New competitor…).
  - ČSTS lookup by IDT: `GET https://www.csts.cz/api/members/{IDT}` → `name`, `surname`, `clubName`; fallback `/api/1/athletes/{IDT}` → `name` ("Surname Name"). No login. Rate-limited (HTTP 429).
- Stored in `<userData>/competitors.json`; photos in `<userData>/photos` (prefix `c-`).

## Getting photos in
| Way | How |
|---|---|
| Drag and drop | image files onto a competitor card |
| File picker | click the empty photo or + |
| Paste | Ctrl+V on the Competitors tab (e.g. copied in WhatsApp Desktop). Goes to the selected competitor, otherwise asks for the number |
| Phone upload | switch on in the tab, scan the QR code on the phone, take a photo, type the number → becomes that competitor's main photo |
| Webcam | Webcam… on a card, live view, Capture. Prefers a "Logitech" camera, remembers the choice |

All images are re-encoded by Chromium (EXIF orientation applied, max 900 px wide), as for judges.

## Phone upload page
- Served by the competitor server (port 8788) at `/upload?key=…` only while switched on.
- Key: random, required on every request (page, competitor list, upload); **New link** makes a new one.
- `GET /upload/list?key=…` → numbers with labels (for "who is this?" on the phone).
- `POST /upload/photo?key=…&number=N` with the image as the body; images only, max 20 MB.
- Unknown number: a typed competitor with only that number is created and marked "from phone"; it moves onto the DanS competitor once DanS gives that number.

## What is on screen (`competitorScreen` in config)
- Header: competition number / title / round, from the DanS competition picked, or typed (typed wins).
- `numbers`: start numbers in the round. **Load from DanS round** = start list + draw of the competition's current round (2 GETs; not in Manual mode, which reads the offline copy).
- `mode`: `round` = every competitor of the list as cards sorted by number, sized to fit like the judge cards; `spotlight` = one competitor large.
- Card: photo with the start number as a back-number card; solo: first name small, surname large; couple: the two surnames, one per line (same text size on every card).
- Couple photos square, solo 3:4.

## Projection
- Second output server, port `competitorPort` (default 8788), all interfaces. Page: `/out/competitors.html`.
- Own draft / pushed (`pushed-competitors.json`) and **Push competitors** button. "Send every change automatically" applies to both projections.
- Style (colours, strip margin, languages) is the event's style, the same as the judges.

## Out of scope
- Reading WhatsApp automatically (against WhatsApp's terms, D-22).
- Two floor halves for competitors (one competitor screen).
