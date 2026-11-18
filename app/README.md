# Dance Projector app

Operator app plus OBS output pages. Reads DanS read-only.

## Run

```
cd app
npm install          # first time only
npm start            # normal use, talks to DanS
npm run fixture      # runs from the anonymised sample event, no DanS needed
npm test             # model, safety and storage tests
```

Options: `--data=<folder>` uses a separate settings folder, `--devtools` opens the developer tools.

## Use

1. Type the DanS server address (for example `http://192.168.1.80`) and press **Connect**. **Save…** keeps it under a name.
2. Choose the data mode: **Manual** (never contacts DanS, uses the offline copy), **On demand** (reads when you press **Fetch now**) or **Automatic** (every 2 s). Every read is kept as the event's offline copy.
3. Choose the event.
4. In **Competitions**, press **Show** on a row to put it on screen. Running competitions (judging enabled) are green and listed first.
5. When the floor is split, tick **Floor is split in two halves**. Rows then get **A** and **B** buttons, and each side gets a Czech and English name and a colour matching the lighting.
6. In **Judge panel**, check the panel from DanS or click judges to pick it by hand. **Use DanS panel** undoes your edits.
7. In **Judges**, click a photo box or drop an image on it, and type the name to show on screen. Click a photo to adjust its crop.
8. In **Style**, set this event's colours and background (moving lights, solid colour or an image).
9. Nothing reaches the screen until you press **Push to projection** in the side panel. The two previews show what you prepared and what is on screen; the line above the button lists what is not pushed yet.
10. Under **On-screen text**, choose the main language and the second language.
11. In OBS, add the output pages as Browser sources (1920 × 1080). The side panel lists the addresses with Copy buttons.

## Output pages

| Page | Address |
|---|---|
| Judges, slot A / B | `http://localhost:8787/out/judges.html?slot=A` |
| Split screen | `http://localhost:8787/out/split.html` |

Add `&bg=1` (or `?bg=1`) to see a page with a dark background in a normal browser. In OBS leave it off, so the page stays transparent.

## Where data is stored

`%APPDATA%\dance-projector\`: `config.json` (server, event, modes, slots, styles), `judges.json` (display names per federation ID), `panels.json` (hand-picked panels), `cache\` (offline copies of DanS data), `photos\`, `media\` (background images), `pushed.json` (what is on screen).

## Updating the sample event

Real snapshots contain personal data and stay in the ignored `fixtures/private/` folder. Only the anonymised sample is committed.

```
npm run snapshot -- http://localhost:8686 CS1761 fixtures/private/pardubice.json
npm run anonymize -- fixtures/private/pardubice.json fixtures/sample.json
```

To run the app on a real snapshot locally: `npx electron . --fixture=fixtures/private/pardubice.json`.
