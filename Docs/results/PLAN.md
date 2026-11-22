# Results announcement – plan (D-26)

| # | Step | State |
|---|---|---|
| 1 | Pure logic `app/src/main/results.js`: final round, readiness, places from the draw, place groups with ties, ladder | done |
| 2 | Poller `fetchResults` (start list + final draw) kept in `raw.results`, also across automatic full reads | done |
| 3 | `resultsState` in `view.js`, part of the competitor projection state; `Projection.pushKeys` | done |
| 4 | IPC `results-set`, `results-load`, `results-step`; window state `results` | done |
| 5 | Output page `/out/results.html` | done |
| 6 | Results tab `app/src/renderer/results.js`, clicker keys | done |
| 7 | Tests `app/scripts/test-results.js` | done |
| 8 | Checked against the venue DanS (CS1747 competition 1) and a made-up tie in a test copy | done |
| 9 | Use at a real announcement | next |
