# Results announcement – specification (D-26)

## Purpose
Announce the results of a finished competition on screen: from the last announced place to the winner, with the
final ladder filling in as each place is revealed.

## Data
- Source: the draw of the competition's **final round**, `GET /api/1/rounds/{final}/draw/competitors` (read-only, already on
  the client's allow-list). Each competitor carries `ranking` (final place) and `ranking_to` (last place of a shared
  place; `null` when not shared). Verified on the venue DanS, MČR 2026-11-21 competition 1 (6 finalists, places 1–6).
- The final round = latest non-cancelled round judged `SkatingFinal` (or abbreviated `F`); a redanced final has a
  cancelled first F.
- Available only when the final is `Finished` (or the competition is Finished / Completed / Closed). Before that the
  window says why.
- Read together with the start list (names, clubs, sponsors): 2 GET requests per **Load results**. Kept in
  `raw.results[finalId]`, so automatic polling does not drop it, and saved in the offline copy (Manual mode uses it).
- Finalists are matched to the Competitors tab by DanS start-list id (`dans:<id>`): photos, typed names, club, sponsor.

## Announcing
- **Top 3**: place groups starting at place 3 or better; competitors tied on 3rd are all included.
  **Whole final**: every ranked competitor of the final.
- Tied competitors share a place ("2.–3.") and are revealed **together**, in one step.
- Reveal order: worst announced place first, winner last.
- Window controls: Hide all · Back · **Reveal <place> place** · Reveal all. A presentation clicker works on the Results
  tab: Page Down / → reveals, Page Up / ← goes back.
- Reveal, Back, Hide all go on screen **at once**: only the `results` part of the competitor projection is pushed
  (`Projection.pushKeys`). Choosing a competition, loading or changing Top 3 / Whole final waits for
  **Push competitors** or the first Reveal, and starts the announcement from the beginning.
- The window lists every place with names, also the hidden ones, marking "on screen" and "next".

## Output page
`/out/results.html` on the competitor port (8788). Header card (follows the competitors' header switch), the place
just revealed large on the left (place, photo with start number, name, club, sponsor; tied competitors side by side),
the ladder on the right (best place at the top; hidden places as an empty line; the current row outlined; tied rows
taller). Only the changed parts redraw, so a reveal animates just the new place. Long names shrink to fit.
