# Competitors on screen – plan

1. **Data** – `competitors.js` (pure: entries from the DanS start list, merge with stored entries, labels for the screen, number list parsing, ČSTS answer parsing); store methods for `competitors.json`.
2. **ČSTS client** – `csts.js`: lookup by IDT, one request at a time, cache, 429 message.
3. **DanS** – read start list + draw of one round on request (`Poller.fetchRoundCompetitors`).
4. **Second projection** – second `OutputServer` on 8788, second `Projection` with its own sections and file; `competitorState()` in `view.js`.
5. **Output page** – `competitors.html`: round grid (fit like judges) and spotlight.
6. **Phone upload** – upload routes on the competitor server (key, size limit), phone page `upload.html`, QR code (`qrcode` package).
7. **Window** – Competitors tab: screen block (competition, numbers, Load from DanS round, mode, spotlight), list with photos / names / IDT lookup, New competitor…, paste, webcam, phone upload box; second push in the Projection box; output list with both ports.
8. **Tests** – `test-competitors.js` (pure functions, store, upload route rules); screenshots of the page and the tab.
9. **Docs** – PROGRESS, root SPEC/PLAN links, memory.
