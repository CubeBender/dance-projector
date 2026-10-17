# Dance Projector app

Operator app plus OBS output pages. Reads DanS read-only.

## Run

```
cd app
npm install          # first time only
npm start            # normal use, talks to DanS
npm run fixture      # runs from the recorded Pardubice snapshot, no DanS needed
npm test             # model, safety and storage tests
```

Options: `--data=<folder>` uses a separate settings folder, `--devtools` opens the developer tools.

## Use

1. Type the DanS server address (for example `http://192.168.1.80`) and press **Connect**.
2. Choose the event.
3. In **Competitions**, press **Show** on a row to put it on screen. Running competitions (judging enabled) are green and listed first.
4. When the floor is split, tick **Floor is split in two halves**. Rows then get **A** and **B** buttons, and each side gets a Czech and English name and a colour matching the lighting.
5. In **Judges**, click a photo box or drop an image on it, and type the name to show on screen. Click a photo to adjust its crop.
6. Under **On-screen text**, choose the main language, the second language and what the heats page shows.
7. In OBS, add the output pages as Browser sources (1920 × 1080). The side panel lists the addresses with Copy buttons.

## Output pages

| Page | Address |
|---|---|
| Heats, slot A / B | `http://localhost:8787/out/heats.html?slot=A` |
| Judges, slot A / B | `http://localhost:8787/out/judges.html?slot=A` |
| Split screen | `http://localhost:8787/out/split.html` |

Add `&bg=1` (or `?bg=1`) to see a page with a dark background in a normal browser. In OBS leave it off, so the page stays transparent.

## Where data is stored

`%APPDATA%\dance-projector\`: `config.json` (server, event, slots, colours), `judges.json` (display names per federation ID), `photos\`.

## Updating the snapshot

```
npm run snapshot -- http://localhost:8686 CS1761 fixtures/pardubice.json
```
