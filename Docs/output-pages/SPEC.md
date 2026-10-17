# Output pages – specification

Served by the control app at `http://<host>:8787`. Built for 1920×1080 OBS browser sources with a transparent background. Pages receive live state over server-sent events from `/events` and never need a reload.

| URL | Shows |
|---|---|
| `/out/heats.html?slot=A` | Heats of the current dance for slot A's competition |
| `/out/judges.html?slot=A` | Judges of slot A's competition with photos |
| `/out/split.html` | Split screen: which competition is on which floor side, in side colours |

Common query options: `bg=1` paints a dark backdrop for testing outside OBS; `scale=0.5` for previews; `lang=cs|en` and `lang2=cs|en|none` override the languages; heats also take `show=full|names|numbers`.

## Floor modes (decision C-08)
- **Whole floor** (default): only slot A; no side label; accent is the whole-floor colour. `split.html` shows one wide panel.
- **Split floor**: slots A and B with side names and lighting colours; `split.html` shows two halves.

## Languages (decisions D-07, C-09)
Every label has the primary language and, smaller underneath, the second language. Titles use the English names built from ČSTS abbreviations.

## Heats
- Header: side colour bar, competition title, round name, current dance name and dance progress (for example 2 / 5).
- Body: one column per heat. Three modes (D-08): number + name + club, number + name, or a board of large number cards only. Layout measures the free space and sizes everything to fill it.
- When no competition is assigned or the round has no heats, the page is empty (fully transparent).

## Judges
- Header like heats.
- Grid of judge cards: photo with the saved crop (or initials on the accent colour), letter, display name. Up to 15 judges fit without scrolling.

## Split
- Two halves in the slot colours. Each half: side label, competition number and title, round, current dance.
- If only one slot has a competition, that half is shown and the other is dimmed.

## Visual style
- Fonts available offline on Windows: Bahnschrift for numbers and titles, Segoe UI for names.
- Smooth fade/slide when the dance or competition changes. No flashing on routine refresh.
