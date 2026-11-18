# Control app – plan

1. Project skeleton in `app/`: package.json, Electron main, preload with a small IPC API.
2. Config and judge store (JSON files in userData).
3. Poller in the main process; publishes state to the window and to the output server.
4. Renderer: connection bar, competitions table, slots, judges editor, outputs list.
5. Run against live DanS and the fixture; check selection and persistence across restarts.

## Revision 2026-11-19
6. `theme.js`, `panels.js`, `projection.js` as plain modules with tests (`scripts/test-workflow.js`).
7. Poller: `fetchOnce()` for on demand, `seed()` from the offline copy. Store: panels, offline copies, media, file cleanup.
8. Server: live and draft channels, `/media/`, `/brand/`, CORS for the OBS branding pages.
9. Window: mode switch, Fetch now, Judge panel and Style tabs, Projection box with previews.
10. Checked in a separate test instance (manual mode on the sample event): panel edit, push, style change, on-demand failure.
