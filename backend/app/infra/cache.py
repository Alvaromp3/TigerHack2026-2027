"""A tiny response cache for the endpoints every screen polls.

Free hosting gives this API a tenth of a CPU, shared with the simulator. Several screens polling the
same census every two seconds should cost one database read, not one each. Any write (POST, PUT,
PATCH, DELETE) clears the cache, so an action shows up on the very next poll; background simulator
changes are at most one TTL late.
"""

import time

# Seconds each polled read may be reused. Fast-moving data gets the shortest window.
TTL_BY_PATH = {
    "/api/census": 1.5,
    "/api/ems/runs": 1.0,
    "/api/ems/status": 2.0,
    "/api/ems/summary": 3.0,
    "/api/public/availability": 3.0,
    "/api/incidents": 3.0,
    "/api/ops": 3.0,
    "/api/flow": 3.0,
    "/api/transfers": 5.0,
    "/api/staff": 10.0,
    "/api/insights": 10.0,
}
MAX_ENTRIES = 64
WRITES = {"POST", "PUT", "PATCH", "DELETE"}


class PollCache:
    """ASGI middleware. Sits inside CORS and gzip, so both still apply to every reply."""

    def __init__(self, app, ttl_by_path: dict[str, float] | None = None):
        self.app = app
        self.ttl_by_path = ttl_by_path or TTL_BY_PATH
        self.store: dict[str, tuple[float, int, list, bytes]] = {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if scope["method"] in WRITES:
            # Before, and again once the write is done: a poll that raced it may have cached old rows.
            self.store.clear()
            try:
                await self.app(scope, receive, send)
            finally:
                self.store.clear()
            return
        ttl = self.ttl_by_path.get(scope["path"])
        if scope["method"] != "GET" or ttl is None:
            await self.app(scope, receive, send)
            return

        key = f'{scope["path"]}?{scope.get("query_string", b"").decode("latin-1")}'
        hit = self.store.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            _, status, headers, body = hit
            # A fresh list every time: gzip and CORS edit the header list in place, and the
            # stored one must stay the plain, uncompressed original.
            await send({"type": "http.response.start", "status": status, "headers": list(headers)})
            await send({"type": "http.response.body", "body": body})
            return

        start: dict = {}
        chunks: list[bytes] = []

        async def capture(message):
            if message["type"] == "http.response.start":
                start.update(status=message["status"], headers=list(message.get("headers", [])))
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))
                if not message.get("more_body") and start.get("status") == 200:
                    if len(self.store) >= MAX_ENTRIES:
                        self.store.clear()
                    self.store[key] = (time.monotonic(), start["status"], start["headers"], b"".join(chunks))
            await send(message)

        await self.app(scope, receive, capture)
