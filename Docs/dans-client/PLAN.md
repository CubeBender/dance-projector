# DanS client – plan

1. `app/src/main/dans.js`: GET-only fetch wrapper with the safety guard.
2. Load lookups once per event, competitions every poll, judges/allocation/start list every 30 s, heats only for rounds shown on screen.
3. Build the derived model described in SPEC.md.
4. Snapshot mode: save one full fetch of the Pardubice event to `app/fixtures/` and allow the app to run from it (`--fixture`), for design work without a live round.
5. Test: a node script prints the model for Pardubice and checks heats match the database read (done once by hand on 2026-10-17).
