# OBS show – specification

- OBS 32.2, 1920×1080 at 60 fps, studio mode, controlled from Touch Portal through obs-websocket (port 4455).
- New scene collection **Dance Projector 2026**, built by `tools/build_obs_show.py`. The 2025 setup stays as collection "Nepojmenované" and in the local `obs/backup-2025`.
- Scene list and sources: see [obs/README.md](../../obs/README.md).

## Requirements
1. **Consistent look:** one shared nested background scene under every graphics scene; all overlays transparent.
2. **Clean transitions:** default fade 600 ms (background identical in both scenes, so only content crossfades); Move transition and Dip to black available; "99 Black" always dips through black.
3. **Videos never run off air:** `pause-media-off-air.lua` pauses media sources on deactivate and resumes on activate; a 2 s safety sweep catches files that start while still loading.
4. **Branding in one place:** `obs/pages/config.js`.
5. **Private data stays local:** media and paths in `obs/assets/` and `obs/private/` (git-ignored).
6. **Touch Portal:** scene names numbered so buttons map 1:1. See [TOUCH_PORTAL.md](TOUCH_PORTAL.md).
