import time

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.infra import VERSION, metrics

router = APIRouter()


@router.get("/health", summary="Service health for load balancers and the platform page")
def health_check(db: Session = Depends(get_db)):
    started = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        database = {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
    except Exception:
        database = {"ok": False, "latency_ms": None}
    ticks = metrics.tick_stats()
    stalled = metrics.uptime_seconds() > 60 and (ticks["age_seconds"] is None or ticks["age_seconds"] > 60)
    return {
        "status": "ok" if database["ok"] and not stalled else "degraded",
        "version": VERSION,
        "uptime_seconds": metrics.uptime_seconds(),
        "database": database,
        "simulation": {"last_tick_age_seconds": ticks["age_seconds"], "stalled": stalled},
        "ai": {"configured": bool(settings.openrouter_api_key)},
        "sso": {"configured": bool(settings.auth0_domain and settings.auth0_client_id)},
    }
