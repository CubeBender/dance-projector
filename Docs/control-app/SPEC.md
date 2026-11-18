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

## 4. Judges
- List of the event's judges: letter, federation name, display name field, photo with **Choose…** and **Remove**.
- With a photo: **Adjust crop** (drag, zoom; frame matches the judge card), **Change photo**, **Remove**. Clicking the photo opens the crop editor.
- Photos are copied to `<userData>/photos/<fedId>-<time>.<ext>`; names and crops in `<userData>/judges.json`.
- Filter: all judges, or only those in slot A/B competitions.

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
