"""Load a page in headless Edge via DevTools, log network traffic, block anything that looks like delivery.

usage: python cdp_sniff.py <url> <out_dir> [seconds]
"""
import asyncio, base64, json, os, subprocess, sys, tempfile, time, urllib.request

import websockets

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9333
BLOCK = ("deliver", "result/delete", "report/delete")

url, out = sys.argv[1], sys.argv[2]
secs = float(sys.argv[3]) if len(sys.argv) > 3 else 12
os.makedirs(out, exist_ok=True)
ATTACH = os.environ.get("CDP_ATTACH")  # attach to an already running app (e.g. Electron) on this port
if ATTACH:
    PORT = int(ATTACH)
    proc = None
else:
    prof = tempfile.mkdtemp(prefix="edgeprof-")
    proc = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
                             "--no-first-run", "--window-size=1920,1080", "about:blank"])


async def main():
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
            page = next(t for t in tabs if t["type"] == "page")
            break
        except Exception:
            time.sleep(0.3)
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
        n = 0
        pending = {}

        async def send(method, params=None):
            nonlocal n
            n += 1
            fut = asyncio.get_event_loop().create_future()
            pending[n] = fut
            await ws.send(json.dumps({"id": n, "method": method, "params": params or {}}))
            return fut

        log = open(os.path.join(out, "requests.jsonl"), "w", encoding="utf8")
        reqs = {}
        bodies = []

        async def reader():
            async for raw in ws:
                m = json.loads(raw)
                if "id" in m and m["id"] in pending:
                    pending.pop(m["id"]).set_result(m.get("result", m.get("error")))
                    continue
                meth, p = m.get("method"), m.get("params", {})
                if meth == "Fetch.requestPaused":
                    u = p["request"]["url"]
                    if any(b in u for b in BLOCK):
                        print("BLOCKED", p["request"]["method"], u)
                        await send("Fetch.failRequest", {"requestId": p["requestId"], "errorReason": "BlockedByClient"})
                    else:
                        await send("Fetch.continueRequest", {"requestId": p["requestId"]})
                elif meth == "Network.requestWillBeSent":
                    r = p["request"]
                    reqs[p["requestId"]] = r
                    rec = {"method": r["method"], "url": r["url"], "type": p.get("type"), "post": r.get("postData")}
                    log.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    print(r["method"], p.get("type"), r["url"])
                    if os.environ.get("CDP_HEADERS") and "/api/" in r["url"]:
                        print("   hdr", json.dumps(r.get("headers", {}), ensure_ascii=False))
                elif meth == "Network.requestWillBeSentExtraInfo" and os.environ.get("CDP_HEADERS"):
                    print("   xhdr", json.dumps(p.get("headers", {}), ensure_ascii=False)[:600])
                elif meth == "Network.responseReceived":
                    resp = p["response"]
                    print("   <-", resp["status"], resp.get("mimeType"), resp["url"])
                    if p.get("type") in ("Fetch", "XHR"):
                        bodies.append((p["requestId"], resp["url"], resp.get("mimeType")))
                elif meth == "Network.eventSourceMessageReceived":
                    log.write(json.dumps({"sse": p.get("eventName"), "data": p.get("data", "")[:4000]}, ensure_ascii=False) + "\n")
                    print("   SSE", p.get("eventName"), len(p.get("data", "")), "bytes")

        rt = asyncio.create_task(reader())
        await (await send("Network.enable", {"maxPostDataSize": 65536}))
        await (await send("Fetch.enable", {"patterns": [{"urlPattern": "*"}]}))
        if not ATTACH:
            await (await send("Emulation.setDeviceMetricsOverride", {"width": 1920, "height": 1080, "deviceScaleFactor": 1, "mobile": False}))
        if url != "-":
            await (await send("Page.navigate", {"url": url}))
        await asyncio.sleep(secs)
        # optional steps file: lines of "js <expression>" or "wait <seconds>"
        steps = os.environ.get("CDP_STEPS")
        if steps:
            for line in open(steps, encoding="utf8"):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                cmd, _, arg = line.partition(" ")
                if cmd == "wait":
                    await asyncio.sleep(float(arg))
                elif cmd == "xy":
                    x, y = map(float, arg.split())
                    for t in ("mouseMoved", "mousePressed", "mouseReleased"):
                        await (await send("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1}))
                    print(f"XY> {x:.0f},{y:.0f}")
                elif cmd == "shot":
                    s = await (await send("Page.captureScreenshot", {"format": "png"}))
                    open(os.path.join(out, f"{arg}.png"), "wb").write(base64.b64decode(s["data"]))
                elif cmd == "click":
                    # arg: JS expression evaluating to an element; we click its centre with real mouse events
                    expr = f"(()=>{{const e=({arg});if(!e)return null;e.scrollIntoView({{block:'center'}});const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,(e.innerText||'').trim().slice(0,60)]}})()"
                    res = await (await send("Runtime.evaluate", {"expression": expr, "returnByValue": True}))
                    val = res.get("result", {}).get("value")
                    if not val:
                        print("CLICK> not found:", arg[:100])
                        continue
                    x, y, label = val
                    for t in ("mouseMoved", "mousePressed", "mouseReleased"):
                        await (await send("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1}))
                    print(f"CLICK> {label!r} at {x:.0f},{y:.0f}")
                elif cmd == "js":
                    res = await (await send("Runtime.evaluate", {"expression": arg, "returnByValue": True, "awaitPromise": True}))
                    print("JS>", json.dumps(res.get("result", res), ensure_ascii=False)[:3000])
        for i, (rid, u, mime) in enumerate(bodies):
            res = await (await send("Network.getResponseBody", {"requestId": rid}))
            if res and "body" in res:
                data = base64.b64decode(res["body"]) if res.get("base64Encoded") else res["body"].encode("utf8")
                fn = os.path.join(out, f"body_{i:03d}.bin")
                open(fn, "wb").write(data)
                print("saved", fn, len(data), mime, u)
        shot = await (await send("Page.captureScreenshot", {"format": "png"}))
        if shot and "data" in shot:
            open(os.path.join(out, "screenshot.png"), "wb").write(base64.b64decode(shot["data"]))
        rt.cancel()


try:
    asyncio.run(main())
finally:
    if proc:
        proc.terminate()
