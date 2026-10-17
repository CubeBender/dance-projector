# OBS show – technical notes (lessons learned)

- **Browser sources share one browser with a limit of 6 connections per host.** Pages that kept a live-update stream (SSE) open used up all six, and every further request to the app (photos, data) waited forever. Fix: pages poll `/api/state?since=<version>` once a second; the server answers 204 when nothing changed and no longer offers a stream. Never add long-lived connections to output pages.
- **OBS injects a default stylesheet** (`body { background-color: rgba(0,0,0,0) … }`) into browser sources unless the source's custom CSS is set to an empty string. The build script sets `css: ""` for the branding pages.
- **CSS `filter: blur()`** on large elements rendered as a grey wash in the OBS browser. The background uses soft gradients instead.
- **obs-websocket cannot create transitions or load scripts.** The build script switches to another collection (OBS saves the file), edits the JSON (`transitions`, `modules.scripts-tool`, `scene_order`, per-scene `private_settings.transition`), and switches back to load it.
- **Scene list order** in the collection file is `scene_order`, top to bottom. `GetSceneList` returns it bottom-up.
- **Media pause:** a pause sent while a file is still opening can report "paused" while it keeps running. The Lua script's 2-second sweep detects position changes off air and pauses again.
- **Checking renders:** `GetSourceScreenshot` on a scene that is in preview gives what OBS really draws; hidden browser sources may not have painted yet.
- **Photos:** the app re-encodes judge photos to baseline JPEG ≤ 900 px on import (originals kept in `photos-original/`). This was added while chasing a missing photo; the real cause turned out to be the connection limit, but the smaller files are still useful.
