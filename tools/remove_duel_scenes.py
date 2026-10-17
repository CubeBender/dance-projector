"""One-off: remove the Duel/VS scenes and the sources only they used."""
import asyncio, sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from obsws import OBS

SCENES = ["Duel 01", "Duel 02", "Duel 03", "Duel 04", "LIVE VS", "LIVE FIGHT"]
DRY = "--dry" in sys.argv


async def main():
    async with OBS() as obs:
        sl = await obs.call("GetSceneList")
        names = [s["sceneName"] for s in sl["scenes"]]
        print("program:", sl["currentProgramSceneName"], "| preview:", sl.get("currentPreviewSceneName"))
        if sl["currentProgramSceneName"] in SCENES:
            sys.exit("Program scene is one to be removed; switch away first.")
        usage = {}
        for n in names:
            for it in (await obs.call("GetSceneItemList", {"sceneName": n}))["sceneItems"]:
                usage.setdefault(it["sourceName"], set()).add(n)
        targets = [s for s in SCENES if s in names]
        orphans = sorted(src for src, used in usage.items() if used and used <= set(targets) and src not in names)
        print("remove scenes:", targets)
        print("remove now-unused sources:", orphans)
        kept = {src: sorted(u) for src, u in usage.items() if u & set(targets) and not u <= set(targets)}
        print("shared sources kept:", kept)
        if DRY:
            return
        for s in targets:
            await obs.call("RemoveScene", {"sceneName": s})
        for src in orphans:
            await obs.call("RemoveInput", {"inputName": src})
        print("remaining scenes:", [s["sceneName"] for s in (await obs.call("GetSceneList"))["scenes"]][::-1])


asyncio.run(main())
