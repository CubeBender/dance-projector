# Heat now / next – plan (D-29)

| # | Step | State |
|---|---|---|
| 1 | Read the venue DanS: no "current heat" anywhere; marks readable with `/rounds/{r}/marks` (crosses, dance and round submissions, no timestamps) | done |
| 2 | Read-only client: `/rounds/{r}/marks` on the allow-list, `marks()` | done |
| 3 | Poller: marks of running rounds every poll (automatic mode), draw once per round, draws kept across polls | done |
| 4 | Pure logic `app/src/main/heattrack.js`: heat plan, quorum, evidence, `RoundTracker` (forward only, Next / Back, auto on / off, "crossing now") | done |
| 5 | Main: trackers per running round, heat log, window state `heats`, IPC `heat-move`, `heat-auto` | done |
| 6 | Heats tab `app/src/renderer/heats.js`, floor-box line, clicker keys | done |
| 7 | Tests `app/scripts/test-heats.js`; `scripts/heatlog.js` | done |
| 8 | Live replay of the CS1747 competition 1 semifinal through a read-only simulator | done |
| 9 | Watch it on real running rounds; read the heat log; tune the quorum if needed | next (user, next event) |
| 10 | Maybe later: load the next heat onto the competitor screen with one click | idea, not asked |
