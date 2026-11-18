# Touch Portal layout (proposal)

Touch Portal's OBS plugin connects to obs-websocket (port 4455, password from OBS **Tools › WebSocket Server Settings**).

Studio mode is on. For remote control from the floor, buttons should **switch the program scene directly** (the transition still plays), so nothing waits for a second tap.

## Page "Show" (4 × 4)

| | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **Row 1 – data** | 11 Judges | 14 Judges B | 04 Schedule | 12 Floor |
| **Row 2 – camera** | 20 LIVE | 21 LIVE + info | (free) | (free) |
| **Row 3 – brand** | 01 Logo | 02 Sponsors | 03 Sponsor video | 30 Break |
| **Row 4 – control** | 99 Black | Transition: Fade | Transition: Move | Toggle studio mode |

- Colour the buttons by row so they can be found without reading: data = floor colour, camera = red, brand = gold, control = grey.
- Use a button state that follows "current program scene" so the phone shows what is on air.
- Row 1, column 2 (Judges B) is only needed on a split floor. Heats scenes were removed on 2026-11-19 (not shown for now).
