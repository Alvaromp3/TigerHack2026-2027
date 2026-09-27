import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, census, chat, health, incidents, ops, rooms, root
from app.core.config import settings
from app.db import SessionLocal, init_db
from app.sim import TICK_SECONDS, tick, tick_seconds

log = logging.getLogger(__name__)


async def _census_loop():
    while True:
        try:
            with SessionLocal() as db:
                delay = tick_seconds(db)
        except Exception:
            delay = TICK_SECONDS
        await asyncio.sleep(delay)
        try:
            with SessionLocal() as db:
                tick(db)
        except Exception:
            log.exception("census tick failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    task = asyncio.create_task(_census_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title=settings.app_name,
    description="Live hospital census for the command center.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(root.router)
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(census.router, prefix="/api", tags=["census"])
app.include_router(ops.router, prefix="/api", tags=["ops"])
app.include_router(rooms.router, prefix="/api", tags=["rooms"])
app.include_router(incidents.router, prefix="/api", tags=["incidents"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
