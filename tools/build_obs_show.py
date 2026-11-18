"""Builds the OBS scene collection for the show through obs-websocket.

usage: python -I tools/build_obs_show.py [--name "Dance Projector 2026"] [--app http://localhost:8787]

- Creates a NEW scene collection; existing collections are never modified.
- Local, private settings (sponsor video path, capture card) come from obs/private/show.local.json (git-ignored):
    { "sponsorVideo": "D:/media/promo.mp4", "captureSettings": { "video_device_id": "..." } }
- Graphics scenes share one nested "~ Background" scene, so the background never blinks during transitions.
- Adds transitions and the pause-media-off-air script by editing the collection file while it is not loaded
  (obs-websocket cannot create transitions or load scripts).
Refuses to run while OBS is streaming or recording.
"""
import argparse, asyncio, json, os, sys, time
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from obsws import OBS

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "obs" / "pages"
SCRIPT = ROOT / "obs" / "scripts" / "pause-media-off-air.lua"
LOCAL = ROOT / "obs" / "private" / "show.local.json"
SCENES_DIR = Path(os.environ["APPDATA"]) / "obs-studio" / "basic" / "scenes"
W, H = 1920, 1080
BG = "~ Background"


def browser(url=None, local=None, restart=False, css=None):
    s = {"width": W, "height": H, "fps_custom": True, "fps": 60, "shutdown": False, "restart_when_active": restart,
         "reroute_audio": False, "webpage_control_level": 1}
    if local:
        # css "" stops OBS from injecting its default stylesheet, which makes page backgrounds transparent
        s.update({"is_local_file": True, "local_file": str(PAGES / local).replace("\\", "/"), "css": ""})
    else:
        s.update({"is_local_file": False, "url": url})
    if css is not None:
        s["css"] = css
    return s


def show_plan(app, local):
    """Scenes in order: (scene name, [items]). Item = (source name, kind, settings) or ("@scene", name)."""
    video = local.get("sponsorVideo") or str(ROOT / "obs" / "assets" / "sponsor-video.mp4")
    cap = local.get("captureSettings") or {}
    out = lambda p: f"{app}/out/{p}"
    return [
        # The branding pages read the event's style (colours, background image) from the app; see obs/pages/brand.js.
        (BG, [("Background", "browser_source", browser(local="background.html"))]),
        ("01 Logo", [("@scene", BG), ("Logo", "browser_source", browser(local="logo.html", restart=True))]),
        ("02 Sponsors", [("@scene", BG), ("Sponsors", "browser_source", browser(local="sponsors.html", restart=True))]),
        ("03 Sponsor video", [("Sponsor video", "ffmpeg_source", {"local_file": video, "is_local_file": True, "looping": True,
                               "restart_on_activate": False, "close_when_inactive": False, "clear_on_media_end": False, "hw_decode": True})]),
        ("04 Schedule", [("@scene", BG), ("Schedule", "browser_source", browser(url=out("schedule.html")))]),
        # Heats scenes ("10 Heats", "13 Heats B") removed 2026-11-19: heats are not shown for now (decision D-13).
        ("11 Judges", [("@scene", BG), ("Judges A", "browser_source", browser(url=out("judges.html?slot=A")))]),
        ("12 Floor", [("@scene", BG), ("Floor overview", "browser_source", browser(url=out("split.html")))]),
        ("14 Judges B", [("@scene", BG), ("Judges B", "browser_source", browser(url=out("judges.html?slot=B")))]),
        ("20 LIVE", [("Camera", "dshow_input", cap)]),
        ("21 LIVE + info", [("@source", "Camera"), ("Lower third A", "browser_source", browser(url=out("lowerthird.html?slot=A")))]),
        ("30 Break", [("@scene", BG), ("Break", "browser_source", browser(local="break.html"))]),
        ("99 Black", []),
    ]


async def build(args):
    local = json.loads(LOCAL.read_text(encoding="utf8")) if LOCAL.exists() else {}
    plan = show_plan(args.app.rstrip("/"), local)
    async with OBS() as obs:
        if (await obs.call("GetStreamStatus"))["outputActive"] or (await obs.call("GetRecordStatus"))["outputActive"]:
            sys.exit("OBS is streaming or recording; not touching it.")
        cols = await obs.call("GetSceneCollectionList")
        original = cols["currentSceneCollectionName"]
        if args.name in cols["sceneCollections"]:
            sys.exit(f'Scene collection "{args.name}" already exists. Use --name for a new one, or delete it in OBS first.')
        await obs.call("CreateSceneCollection", {"sceneCollectionName": args.name})  # switches to it
        await asyncio.sleep(1.5)
        default_scenes = [s["sceneName"] for s in (await obs.call("GetSceneList"))["scenes"]]

        made_inputs = set()
        for scene, items in plan:
            await obs.call("CreateScene", {"sceneName": scene})
            for it in items:
                if it[0] == "@scene" or it[0] == "@source":
                    r = await obs.call("CreateSceneItem", {"sceneName": scene, "sourceName": it[1]})
                    item_id, src = r["sceneItemId"], it[1]
                else:
                    name, kind, settings = it
                    r = await obs.call("CreateInput", {"sceneName": scene, "inputName": name, "inputKind": kind, "inputSettings": settings, "sceneItemEnabled": True})
                    item_id, src = r["sceneItemId"], name
                    made_inputs.add(name)
                # every item fills the canvas (camera keeps its aspect ratio)
                await obs.call("SetSceneItemTransform", {"sceneName": scene, "sceneItemId": item_id, "sceneItemTransform": {
                    "positionX": 0, "positionY": 0, "alignment": 5, "boundsType": "OBS_BOUNDS_SCALE_INNER",
                    "boundsWidth": W, "boundsHeight": H, "boundsAlignment": 0}})
                if src == BG or it[0] == "@scene":
                    await obs.call("SetSceneItemLocked", {"sceneName": scene, "sceneItemId": item_id, "sceneItemLocked": True})
        for s in default_scenes:
            await obs.call("RemoveScene", {"sceneName": s})
        await obs.call("SetCurrentProgramScene", {"sceneName": "99 Black"})
        try:
            await obs.call("SetCurrentPreviewScene", {"sceneName": "01 Logo"})
        except RuntimeError:
            pass
        fade_name = (await obs.call("GetCurrentSceneTransition"))["transitionName"]

        # Switch away so OBS writes the new collection to disk, add transitions + script, switch back to load them.
        await obs.call("SetCurrentSceneCollection", {"sceneCollectionName": original})
        await asyncio.sleep(2.5)
        file = find_collection_file(args.name)
        patch_collection(file, fade_name)
        await obs.call("SetCurrentSceneCollection", {"sceneCollectionName": args.name})
        await asyncio.sleep(3)
        print("scenes:", [s["sceneName"] for s in (await obs.call("GetSceneList"))["scenes"]][::-1])
        print("transitions:", [t["transitionName"] for t in (await obs.call("GetSceneTransitionList"))["transitions"]])
        print("collection file:", file)


def find_collection_file(name):
    for f in SCENES_DIR.glob("*.json"):
        try:
            if json.loads(f.read_text(encoding="utf8")).get("name") == name:
                return f
        except Exception:
            continue
    sys.exit(f"collection file for {name} not found in {SCENES_DIR}")


def patch_collection(file, fade_name):
    d = json.loads(file.read_text(encoding="utf8"))
    d["transitions"] = [
        {"name": "Move", "id": "move_transition", "versioned_id": "move_transition", "settings": {}},
        {"name": "Dip to black", "id": "fade_to_color_transition", "versioned_id": "fade_to_color_transition",
         "settings": {"color": 4278190080, "switch_point": 50}},
    ]
    # Scene list top to bottom: 01, 02 … 99, helper scenes ("~ …") last.
    d["scene_order"] = sorted(d.get("scene_order", []), key=lambda s: (s["name"].startswith("~"), s["name"]))
    d["current_transition"] = fade_name
    d["transition_duration"] = 600
    d.setdefault("modules", {})["scripts-tool"] = [
        {"path": str(SCRIPT).replace("\\", "/"), "settings": {"enabled": True, "restart": ""}}]
    # Per-scene transition: going to black dips through black.
    for s in d.get("sources", []):
        if s.get("name") == "99 Black":
            s.setdefault("private_settings", {}).update({"transition": "Dip to black", "transition_duration": 800})
    file.write_text(json.dumps(d, ensure_ascii=False, indent=4), encoding="utf8")


async def patch_only(args):
    """Re-apply transitions, script and scene order to an existing collection."""
    async with OBS() as obs:
        cols = await obs.call("GetSceneCollectionList")
        if args.name not in cols["sceneCollections"]:
            sys.exit(f'No collection "{args.name}"')
        other = next((c for c in cols["sceneCollections"] if c != args.name), None)
        if not other:
            sys.exit("Need a second scene collection to switch to while patching.")
        await obs.call("SetCurrentSceneCollection", {"sceneCollectionName": other})
        await asyncio.sleep(2.5)
        await obs.call("SetCurrentSceneCollection", {"sceneCollectionName": args.name})
        await asyncio.sleep(2.5)
        fade_name = (await obs.call("GetCurrentSceneTransition"))["transitionName"]
        if fade_name in ("Move", "Dip to black"):
            fade_name = next(t["transitionName"] for t in (await obs.call("GetSceneTransitionList"))["transitions"] if t["transitionKind"] == "fade_transition")
        await obs.call("SetCurrentSceneCollection", {"sceneCollectionName": other})
        await asyncio.sleep(2.5)
        patch_collection(find_collection_file(args.name), fade_name)
        await obs.call("SetCurrentSceneCollection", {"sceneCollectionName": args.name})
        await asyncio.sleep(3)
        print("scenes (bottom-up):", [s["sceneName"] for s in (await obs.call("GetSceneList"))["scenes"]])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="Dance Projector 2026")
    ap.add_argument("--app", default="http://localhost:8787")
    ap.add_argument("--patch-only", action="store_true", help="only re-apply transitions, script and scene order")
    a = ap.parse_args()
    asyncio.run(patch_only(a) if a.patch_only else build(a))
