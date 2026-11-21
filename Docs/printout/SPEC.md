# Reading DanS printouts – specification

Request: PROMPT.md §11 (and §4, the webcam idea). Decisions: D-17, D-24, C-39 to C-41 in DECISIONS.md.

## Situation on the event day
The app may have **no connection to the DanS that runs the event**, only the offline copy read beforehand
(competitions, start list without numbers, the event's judge list) and the judge gallery. What competition runs, its
judges and who dances in a round arrive on **paper printed by DanS**.

## The sheet
DanS's **round start list** ("Startovní listina", report `startlist`, `round_startlist.rs`) has everything:

| Part | Example | Used for |
|---|---|---|
| Title line | `Startovní listina   1 · Do 8 let E Solo SoKOMB · Finále` | competition (number + title) and round |
| Event line | `Pardubický podzimní pohár … Pardubice · 2026-10-17` | – |
| Table `№ Soutěžící Klub Země` | `1  Jana Nováková  KLUB A` | start numbers and who is in the round |
| `Porota` | `B — Jakub Novák, H — Eva Malá, …` | judge panel with letters |
| `Rozlosování skupin` | heats | – |

Other DanS reports print the same kind of lines (`advancing`, `judges-comp`, …); they are read the same way but were
not seen yet. Samples kept locally (not in git): `%LOCALAPPDATA%\dans\*.pdf`.

## Reading
1. Photo: live webcam frame (as many pixels as the camera gives), a pasted image (Ctrl+V), a file, or the phone page
   in **Printout** mode (sends up to 2400 px; the review window opens on the laptop).
2. The photo is prepared in the hidden Chromium window: enlarged up to 2×, grey, light evened out (divided by a
   heavily blurred copy).
3. Tesseract (tesseract.js 7, Czech `best_int` data from `@tesseract.js-data/ces`, offline) reads both the prepared and
   the original image.
4. `printout.js` matches each reading against what is known, and the two readings are combined:
   - header: competition by number + title (a misread number is found by the title), round by the competition's own
     round names;
   - competitors: every known competitor's name is looked for in each line (both name orders, forgiving comparison);
     the start number is the last number before the name; couples must be on one line (or the next line without a
     number); lines of the `Porota` part are skipped; one competitor per line; a solo competition drops couples;
   - judges: the `Porota` part is split at `<letter> —`; each name is matched against the event's judges and the
     gallery; a judge found without a readable letter is listed with an empty letter.
   - Each item has a score; **sure** = at least 0.82 and clearly better than the next candidate, its number not
     used twice. Everything else is marked **check**.

## Review and apply
The window shows the photo and editable rows (number + competitor, letter + judge), unsure rows highlighted, the
recognised text on request. **Apply**:
- Competitors → competitor screen: competition, round name, the numbers of the rows; each competitor gets the number
  as **number from printout** (`printNumber`) unless DanS's own number already says so. A number given earlier to
  someone else is taken back.
- Judges → **own selection** of side A (or B with a split floor), with the letters and the header; judges of the
  event not in the gallery get a gallery entry (names only).
- Nothing reaches the screen until Push.

## Measured (2026-11-20, a real round start list, simulated webcam frames)
| Photo | Header | Competitors | Judges |
|---|---|---|---|
| clean scan | ✓ | 3/3 sure | 7/7 with letters |
| webcam, top of the sheet filling the frame | ✓ | 3/3 (after combining) | 7/7 with letters |
| webcam, whole A4 in frame | ✓ | 3/3 sure | 7/7, 2 without letter (check), 1 letter misread |
| webcam on its side, whole A4 (either way round) | ✓ | 3/3 sure | 7/7 sure, all letters |

One read takes about 2–3 s (two recognitions); about 5 s for a full page; the first read of a picture on its side
8–11 s while the app finds the way up (C-42).

## Which way up (C-42)
A webcam turned on its side fits a whole A4 page with more pixels on it. The app finds the way up by itself: the
remembered turn first, the other quarter turns when that reads as junk (nothing known found, confidence below 65 %);
the turn that worked is remembered for the camera. The live picture is shown turned; **↻ Turn** sets it by hand.
Photos from a file, Ctrl+V or the phone start upright and leave the camera's turn alone.
