# Control app – specification

Electron desktop app for the operator. One window, four areas.

## 1. Connection bar
- DanS server address (default `http://localhost:8686`), event dropdown, connection status dot with last update time.
- Fixture mode badge when running from a snapshot.

## 2. Competitions
- Table: number, title, state, check-in end, current round and dance, checked-in count.
- Running competitions are highlighted and sorted to the top; a filter can hide finished ones.
- Each row has two buttons, **A** and **B**, to put the competition on display slot A or B. Pressing an active button clears the slot.
- Optional "follow running" per slot: the slot takes the running competition automatically when exactly one new one starts. Off by default.

## 3. Floor, slots and sides
- Switch "Floor is split in two halves" (off by default, decision C-08).
- Off: one "Whole floor" slot (A) with an accent colour; rows in the list have a single **Show** button.
- On: slots A and B, each with a Czech and an English side name, a colour picker, the assigned competition and what is on screen now.

## 3b. On-screen text
- Main language (Czech or English), second language (English, Czech or none).
- Heats page mode: number + name + club, number + name, numbers only.

## 4. Judges
- List of the event's judges: letter, federation name, display name field, photo with **Choose…** and **Remove**.
- With a photo: **Adjust crop** (drag, zoom; frame matches the judge card), **Change photo**, **Remove**. Clicking the photo opens the crop editor.
- Photos are copied to `<userData>/photos/<fedId>-<time>.<ext>`; names and crops in `<userData>/judges.json`.
- Filter: all judges, or only those in slot A/B competitions.

## 5. Outputs
- List of output page URLs with a copy button and a live preview thumbnail.

## Persistence
- `<userData>/config.json`: server, event, slots, sides, poll interval, running-state mapping.
