"""In-process service metrics: API traffic and simulation engine ticks.

Kept in memory on purpose: they describe this running instance, like a /metrics endpoint would.
"""

import threading
import time
from collections import deque

STARTED_AT = time.time()

_lock = threading.Lock()
_requests: deque = deque(maxlen=6000)  # (timestamp, group, status, milliseconds)
_ticks: deque = deque(maxlen=60)  # (timestamp, ok, milliseconds)


def record_request(group: str, status: int, milliseconds: float) -> None:
    with _lock:
        _requests.append((time.time(), group, status, milliseconds))


def record_tick(ok: bool, milliseconds: float) -> None:
    with _lock:
        _ticks.append((time.time(), ok, milliseconds))


def uptime_seconds() -> int:
    return int(time.time() - STARTED_AT)


def _percentile(values: list[float], share: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return round(ordered[index], 1)


def request_stats(window_seconds: int = 300) -> dict:
    now = time.time()
    with _lock:
        rows = [row for row in _requests if now - row[0] <= window_seconds]
        history = list(_requests)
    minutes = window_seconds / 60
    groups = {}
    for name in ("api", "fhir"):
        picked = [row for row in rows if row[1] == name]
        durations = [row[3] for row in picked]
        errors = sum(1 for row in picked if row[2] >= 500)
        groups[name] = {
            "per_minute": round(len(picked) / minutes, 1),
            "p50_ms": _percentile(durations, 0.5),
            "p95_ms": _percentile(durations, 0.95),
            "error_rate": round(errors / len(picked), 3) if picked else 0.0,
            "total": len(picked),
        }
    # One bar per minute for the last 30 minutes: ok, degraded (5xx seen) or idle.
    bars = []
    for minute in range(29, -1, -1):
        start, end = now - (minute + 1) * 60, now - minute * 60
        bucket = [row for row in history if start < row[0] <= end]
        if not bucket:
            bars.append("idle")
        elif any(row[2] >= 500 for row in bucket):
            bars.append("degraded")
        else:
            bars.append("ok")
    return {"window_seconds": window_seconds, **groups, "bars": bars}


def tick_stats() -> dict:
    with _lock:
        ticks = list(_ticks)
    if not ticks:
        return {"last_at": None, "age_seconds": None, "p50_ms": None, "success_rate": None, "bars": []}
    last = ticks[-1]
    return {
        "last_at": last[0],
        "age_seconds": round(time.time() - last[0], 1),
        "p50_ms": _percentile([tick[2] for tick in ticks], 0.5),
        "success_rate": round(sum(1 for tick in ticks if tick[1]) / len(ticks), 3),
        "bars": ["ok" if tick[1] else "failed" for tick in ticks],
    }
