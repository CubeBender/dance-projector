# Control app – specification

Electron desktop app for the operator. Top bar, four tabs (Competitions, Judge panel, Judges, Style) and a side panel (Projection, Floor, Output pages, On-screen text, Settings).

## 1. Connection bar
- DanS server address (default `http://localhost:8686`), event dropdown, connection status dot with last update time.
- Saved servers (decision C-17): a dropdown of named servers next to the address; choosing one connects. **Save…** names the address in the field; **Edit…** (shown when the address is already saved) renames it, changes its address or deletes it. Addresses are normalised (`http://` added, trailing `/` removed).
- Data mode switch (D-13): **Manual** (never contacts DanS; event list = events with an offline copy), **On demand** (reads only on **Fetch now**: the first read gets everything, later reads get competitions, judges and allocation = 3 GET requests), **Automatic** (polls every 2 s). Default for new setups: On demand.
- Status text per mode: automatic – last update; on demand – time of the shown data or the last error; manual – age of the offline copy.
- Every successful read is saved as the event's offline copy (`<userData>/cache/<event>.json`); selecting an event shows its copy at once.
- Fixture mode badge when running from a snapshot.

## 2. Competitions
- Table: number, title, state, check-in end, current round and dance, checked-in count.
- Running competitions are highlighted and sorted to the top; a filter can hide finished ones.
- Each row has two buttons, **A** and **B**, to put the competition on display slot A or B. Pressing an active button clears the slot.
- Optional "follow running" per slot: the slot takes the running competition automatically when exactly one new one starts. Off by default.

## 3. Floor, slots and sides
- Switch "Floor is split in two halves" (off by default, decision C-08).
- Off: one "Whole floor" slot (A) in the style's accent colour; rows in the list have a single **Show** button.
- On: slots A and B, each with a Czech and an English side name, a colour picker, the assigned competition and what is on screen now.

## 3b. On-screen text
- Main language (Czech or English), second language (English, Czech or none).

## 4. Judges – the gallery (decision D-18)
- A gallery kept between events, one entry per judge **IDT** (the federation id DanS reports). The tab lists every gallery judge plus the current event's judges (marked "In this event"; "Not in gallery yet" until something is saved).
- Each card: main portrait (click = crop editor; drop an image = add it as the new main photo), IDT, letter at this event, editable **Name** and **Surname** (DanS names as placeholders; a note when DanS spells them differently), optional **Name on screen** (e.g. with a title), and a strip of all photos: click = make main, × then "Delete?" = delete, + or drop = add photos.
- Crop (focus point and zoom, frame matches the judge card) is stored per photo. The Adjust photo window can also turn the photo 90° left or right (↺ / ↻); this writes a turned copy and resets the framing.
- Images are decoded by Chromium (hidden window, `imagedecode.js`): EXIF orientation is applied and JPEGs missing their last bytes still import (decision C-25). Importing a folder again redoes photos imported by older versions from their originals.
- **Import folder…** reads files named `IDT_Surname_Name[ Number].jpg|jpeg|png|webp` (default folder `Docs/judges`, which is git-ignored). New judges get the names from the file name; names already in the gallery are kept. Photos already imported (same file content, SHA-1) are skipped, so a folder can be imported again after adding photos. The report lists added, skipped, unrecognised and unreadable files.
- **New judge…** adds a judge by IDT, name and surname.
- Filters: all, in this event, on screen now, without photo; search by IDT or name.
- Photos are re-encoded (baseline JPEG, max 900 px) into `<userData>/photos/`; the gallery is `<userData>/judges.json` (shape in `app/src/main/gallery.js`; older single-photo entries are converted on load). Deleted photos stay on disk until the next push or start, so the screen never loses an image it still shows.
- On screen: gallery names win over DanS; Name on screen wins over both; the main photo with its crop.

## 4b. Judge panel (D-13, D-14)
- One block per competition on screen (A, and B on a split floor): title, round, where the panel comes from (**Panel from DanS**, **Picked by hand** with the difference to DanS, or **No panel yet**), number selected.
- All judges of the event as toggle buttons (photo, letter, name). Judges in the DanS panel have a green ring on their letter.
- Clicking edits the panel; the first edit of a DanS panel starts from the DanS list. **Use DanS panel** forgets the edit; **Clear** empties the panel.
- Edits are stored in `<userData>/panels.json` per event and competition.

## 4c. Style (D-15)
- One style per event: accent, second colour, background colour, panel colour, panel opacity; background **Moving lights**, **Solid colour** or **Image** (drop or choose; re-encoded to max 1920 px in `<userData>/media/`; darkening 0–90 %). **Reset style to default**.
- Older configs' whole-floor colour becomes the current event's accent once.

## 4d. Projection (D-13)
- **Prepared** and **On screen** previews of a chosen output page over the background, scaled from 1920×1080.
- "Not on screen yet:" lists the changed parts (competition/panel A or B, schedule, style, floor split/languages).
- **Push to projection** puts the prepared state on screen; disabled when nothing changed. Last push time.
- **Send every change automatically** skips the push step (pre-2026-11 behaviour).
- The pushed state is kept in `<userData>/pushed.json` and shown again after a restart. Photos and images the screen still shows are kept until the next push.

## 5. Outputs
- List of output page URLs with a copy button and a live preview thumbnail.

## Persistence
- `<userData>/config.json`: server, saved servers, event, data mode, projection mode, styles, slots, sides, poll interval, running-state mapping.
- `<userData>/panels.json`, `cache/`, `media/`, `pushed.json`: see the sections above.
