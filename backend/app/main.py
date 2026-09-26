import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, census, health, root
from app.core.config import settings
from app.db import SessionLocal, init_db
from app.sim import TICK_SECONDS, tick

log = logging.getLogger(__name__)


async def _census_loop():
    while True:
        await asyncio.sleep(TICK_SECONDS)
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
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
