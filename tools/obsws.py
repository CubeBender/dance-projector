"""Minimal obs-websocket v5 client. Reads host/port/password from the local OBS config."""
import asyncio, base64, hashlib, json, os, uuid

import websockets

CONFIG = os.path.join(os.environ["APPDATA"], "obs-studio", "plugin_config", "obs-websocket", "config.json")


class OBS:
    def __init__(self, host="localhost", port=None, password=None):
        cfg = json.load(open(CONFIG, encoding="utf8"))
        self.url = f"ws://{host}:{port or cfg.get('server_port', 4455)}"
        self.password = password if password is not None else cfg.get("server_password", "")

    async def __aenter__(self):
        self.ws = await websockets.connect(self.url, max_size=None)
        hello = json.loads(await self.ws.recv())["d"]
        ident = {"rpcVersion": 1, "eventSubscriptions": 0}
        auth = hello.get("authentication")
        if auth:
            secret = base64.b64encode(hashlib.sha256((self.password + auth["salt"]).encode()).digest()).decode()
            ident["authentication"] = base64.b64encode(hashlib.sha256((secret + auth["challenge"]).encode()).digest()).decode()
        await self.ws.send(json.dumps({"op": 1, "d": ident}))
        msg = json.loads(await self.ws.recv())
        if msg["op"] != 2:
            raise RuntimeError(f"identify failed: {msg}")
        return self

    async def __aexit__(self, *exc):
        await self.ws.close()

    async def call(self, request_type, data=None):
        rid = str(uuid.uuid4())
        await self.ws.send(json.dumps({"op": 6, "d": {"requestType": request_type, "requestId": rid, "requestData": data or {}}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg["op"] == 7 and msg["d"]["requestId"] == rid:
                st = msg["d"]["requestStatus"]
                if not st["result"]:
                    raise RuntimeError(f"{request_type} failed: {st}")
                return msg["d"].get("responseData", {})
