# Control app – plan

1. Project skeleton in `app/`: package.json, Electron main, preload with a small IPC API.
2. Config and judge store (JSON files in userData).
3. Poller in the main process; publishes state to the window and to the output server.
4. Renderer: connection bar, competitions table, slots, judges editor, outputs list.
5. Run against live DanS and the fixture; check selection and persistence across restarts.
