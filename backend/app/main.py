import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import ems as ems_engine
from app.api.routes import auth, census, chat, decisions, ems, fhir, health, incidents, insights, ops, platform, public, rooms, root
from app.core.config import settings
from app.db import SessionLocal, init_db
from app.infra import VERSION, metrics
from app.infra.webhooks import dispatch_pending
from app.sim import TICK_SECONDS, tick, tick_seconds

log = logging.getLogger(__name__)

WEBHOOK_INTERVAL_SECONDS = 3
EMS_INTERVAL_SECONDS = 5

TAGS = [
    {"name": "Health", "description": "Service health for load balancers and monitors."},
    {"name": "Census", "description": "Live bed census, patient flow, staff roster and transfers."},
    {"name": "Operations", "description": "What needs doing now: cleans, holds, coverage and waits."},
    {"name": "Beds", "description": "Bed actions: hold, release, assign housekeeping, open, discharge."},
    {"name": "Incidents", "description": "Take a bed out of service and bring it back."},
    {"name": "Ambulances", "description": "Pre-alerts from ambulances, acceptance, diversion, arrival and handoff."},
    {"name": "Public", "description": "Open availability database and routing for ambulance companies. No patient data."},
    {"name": "Decisions", "description": "Hospital-level decisions: call in on-call physicians, transfer overflow."},
    {"name": "Insights", "description": "Flow trends, bed turnover and length of stay."},
    {"name": "Platform", "description": "Integration layer: event stream, signed webhooks, audit trail, regional network."},
    {"name": "FHIR R4", "description": "Standards-based read API: Location, Encounter, Patient, Observation."},
    {"name": "Assistant", "description": "Gemini-backed operations assistant and hourly briefing."},
    {"name": "Auth", "description": "Single sign-on configuration."},
]


async def _census_loop():
    while True:
        try:
            with SessionLocal() as db:
                delay = tick_seconds(db)
        except Exception:
            delay = TICK_SECONDS
        await asyncio.sleep(delay)
        started = time.perf_counter()
        try:
            with SessionLocal() as db:
                tick(db)
            metrics.record_tick(True, (time.perf_counter() - started) * 1000)
        except Exception:
            metrics.record_tick(False, (time.perf_counter() - started) * 1000)
            log.exception("census tick failed")


async def _webhook_loop():
    while True:
        await asyncio.sleep(WEBHOOK_INTERVAL_SECONDS)
        try:
            # Off the event loop: a subscription may point back at this server (the sandbox).
            await asyncio.to_thread(dispatch_pending)
        except Exception:
            log.exception("webhook dispatch failed")


def _ems_step():
    with SessionLocal() as db:
        ems_engine.tick(db, generate=settings.ems_autopilot)


async def _ems_loop():
    while True:
        await asyncio.sleep(EMS_INTERVAL_SECONDS)
        try:
            await asyncio.to_thread(_ems_step)
        except Exception:
            log.exception("ambulance tick failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    tasks = [
        asyncio.create_task(_census_loop()),
        asyncio.create_task(_webhook_loop()),
        asyncio.create_task(_ems_loop()),
    ]
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="SurgeCommand Hospital Operations API",
    summary="The operational layer of Tiger Memorial Hospital.",
    description=(
        "Hospital monitoring for better triage and ambulance communication. Every unit's live capacity is "
        "published as an open availability database, FHIR R4 and signed CloudEvents webhooks, so ambulance "
        "companies know where to take each patient. Clinical feeds, partner hospitals and ambulance traffic are "
        "emulated by a simulation engine; every patient is synthetic."
    ),
    version=VERSION,
    openapi_tags=TAGS,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _measure(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    path = request.url.path
    group = "fhir" if path.startswith("/fhir") else "api" if path.startswith("/api") else None
    if group:
        metrics.record_request(group, response.status_code, (time.perf_counter() - started) * 1000)
    return response


app.include_router(root.router)
app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(census.router, prefix="/api", tags=["Census"])
app.include_router(ops.router, prefix="/api", tags=["Operations"])
app.include_router(rooms.router, prefix="/api", tags=["Beds"])
app.include_router(incidents.router, prefix="/api", tags=["Incidents"])
app.include_router(decisions.router, prefix="/api", tags=["Decisions"])
app.include_router(ems.router, prefix="/api/ems", tags=["Ambulances"])
app.include_router(public.router, prefix="/api/public", tags=["Public"])
app.include_router(insights.router, prefix="/api", tags=["Insights"])
app.include_router(platform.router, prefix="/api/platform", tags=["Platform"])
app.include_router(fhir.router, prefix="/fhir", tags=["FHIR R4"])
app.include_router(chat.router, prefix="/api", tags=["Assistant"])
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
