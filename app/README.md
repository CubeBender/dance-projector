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
6. In **Judges** (top part), choose per side: **From DanS** (check the panel of the competition shown, or click judges to change it; **Use DanS panel** undoes your edits) or **Own selection** (pick judges from the gallery, letters A, B, C… are given and can be changed, optionally type the competition number and title). Own selection works without any DanS connection.
7. In **Judges** (the gallery, kept between events), press **Import folder…** to bring in photos named `IDT_Surname_Name[ Number].jpg`, for example from `Docs/judges` (importing again only adds new photos). Edit name and surname, click a small photo to make it the main one, × twice to delete it, + to add more. Click the big photo to adjust its framing. **Delete judge…** removes a judge from the gallery after asking. Click a judge card, then **Ctrl+V** to paste a copied photo as its main photo.
7b. In **Competitors**, each card also has **Club** and **Sponsor** (taken from DanS; type to change them). Both appear on the competitor and results pages.
7e. What the app collected about an event is deleted 3 days after it: competitor photos (mostly children), what was typed about the competitors, the offline copy of its DanS data and the heat log. The number of days is under **Settings**. Judge photos are kept, and DanS's own data is never touched.
7d. In **Heats**, every running round shows the heat on the floor **now** and the **next** one with the start numbers. In **Automatic** mode the app follows the judges' crosses (a heat counts once a third of the judges have crossed in it, so a lagging judge or a wrong number doesn't move it). **Next heat** / **Back** (or Page Down / Page Up) set it by hand. The side-panel floor boxes show the same in one line. After an event, `node scripts/heatlog.js "%APPDATA%\dance-projector\heatlog\<date>.jsonl"` shows how the marks arrived.
7c. In **Results**, pick a finished competition, press **Load results** (reads the final from DanS), choose **Top 3** or **Whole final**, and press **Reveal** for each place, from the last to the winner. Reveal goes on screen at once; Page Down / Page Up on a presentation clicker work too.
8. In **Style**, set this event's colours and background (moving lights, solid colour or an image).
9. Nothing reaches the screen until you press **Push to projection** in the side panel. The two previews show what you prepared and what is on screen; the line above the button lists what is not pushed yet.
10. Under **On-screen text**, choose the main language and the second language.
11. In OBS, add the output pages as Browser sources (1920 × 1080). The side panel lists the addresses with Copy buttons.

## Output pages

| Page | Address |
|---|---|
| Judges, slot A / B | `http://localhost:8787/out/judges.html?slot=A` |
| Split screen | `http://localhost:8787/out/split.html` |
| Competitors | `http://localhost:8788/out/competitors.html` |
| Results | `http://localhost:8788/out/results.html` |

Add `&bg=1` (or `?bg=1`) to see a page with a dark background in a normal browser. In OBS leave it off, so the page stays transparent.

## Where data is stored

`%APPDATA%\dance-projector\`: `config.json` (server, event, modes, slots, styles), `judges.json` (judge gallery per IDT: names, photos, main photo, crops), `panels.json` (hand-picked panels), `cache\` (offline copies of DanS data), `photos\`, `media\` (background images), `pushed.json` (what is on screen), `heatlog\` (judges' marks of running rounds as they arrived, for checking heat tracking; real data).

## Updating the sample event

Real snapshots contain personal data and stay in the ignored `fixtures/private/` folder. Only the anonymised sample is committed.

```
npm run snapshot -- http://localhost:8686 CS1761 fixtures/private/pardubice.json
npm run anonymize -- fixtures/private/pardubice.json fixtures/sample.json
```

To run the app on a real snapshot locally: `npx electron . --fixture=fixtures/private/pardubice.json`.
