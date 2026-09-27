"""The integration platform: health, event stream, webhooks, sandbox receiver, audit, network."""

import json
import math
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.infra import VERSION, fhir, hl7, metrics
from app.infra.audit import get_actor, record
from app.infra.events import (
    EVENT_TYPE_NAMES,
    EVENT_TYPES,
    SYSTEMS,
    classify,
    cloud_event,
    destination,
    event_row,
    iso,
)
from app.infra.webhooks import (
    SIGNATURE_HEADER,
    SUBSCRIPTION_HEADER,
    filters,
    mask,
    new_secret,
    send_test,
    verify,
)
from app.models import (
    AuditEntry,
    FlowEvent,
    Room,
    SandboxMessage,
    Transfer,
    WebhookDelivery,
    WebhookSubscription,
)
from app.sim import OUTSIDE_HOSPITAL

router = APIRouter()

VOLUME_BUCKETS = 12  # 12 x 5 min = the last hour
KEEP_SANDBOX = 50


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _integration_status(system: dict, last_at: datetime | None, now: datetime) -> str:
    if system["id"] == "identity":
        return "connected" if settings.auth0_domain and settings.auth0_client_id else "not_configured"
    if system["id"] == "ops-ai":
        return "connected" if settings.google_api_key else "not_configured"
    if system["mode"] == "available":
        return "not_connected"
    if last_at is None:
        return "waiting"
    age = (now - last_at).total_seconds()
    if age <= 900:
        return "healthy"
    if age <= 3600:
        return "idle"
    return "silent"


def _ai_model() -> str | None:
    from app.api.routes.chat import _working_model

    return _working_model["name"] or settings.google_model


@router.get("/catalog", summary="Systems and event types known to the platform")
def catalog():
    return {
        "systems": list(SYSTEMS),
        "event_types": [{"type": name, "description": text_} for name, text_ in EVENT_TYPES],
    }


@router.get("/overview", summary="Platform health, integration status and alerts")
def overview(db: Session = Depends(get_db)):
    now = _now()
    started = time.perf_counter()
    db.execute(text("SELECT 1"))
    db_ms = round((time.perf_counter() - started) * 1000, 1)

    recent = db.scalars(
        select(FlowEvent)
        .where(FlowEvent.created_at >= now - timedelta(minutes=60))
        .order_by(FlowEvent.id.desc())
        .limit(4000)
    ).all()
    last_seen: dict[str, datetime] = {}
    volume = {system["id"]: [0] * VOLUME_BUCKETS for system in SYSTEMS}
    last_five = 0
    for row in recent:
        info = classify(row.patient_name, row.message, row.kind, row.room_id)
        stamp = _aware(row.created_at)
        age = (now - stamp).total_seconds()
        bucket = min(VOLUME_BUCKETS - 1, int(age // 300))
        volume.setdefault(info["system"], [0] * VOLUME_BUCKETS)[VOLUME_BUCKETS - 1 - bucket] += 1
        last_seen.setdefault(info["system"], stamp)
        if age <= 300:
            last_five += 1
    missing = [s["id"] for s in SYSTEMS if s["mode"] != "available" and s["id"] not in last_seen]
    if missing:
        for row in db.scalars(select(FlowEvent).order_by(FlowEvent.id.desc()).offset(len(recent)).limit(600)).all():
            info = classify(row.patient_name, row.message, row.kind, row.room_id)
            last_seen.setdefault(info["system"], _aware(row.created_at))

    integrations = []
    for system in SYSTEMS:
        last_at = last_seen.get(system["id"])
        series = volume.get(system["id"], [0] * VOLUME_BUCKETS)
        integrations.append({
            **system,
            "status": _integration_status(system, last_at, now),
            "last_event_at": iso(last_at),
            "events_60m": sum(series),
            "volume": series,
        })
    connected = [row for row in integrations if row["mode"] != "available"]
    healthy = [row for row in connected if row["status"] in ("healthy", "connected", "idle")]

    messages_24h = db.scalar(
        select(func.count()).select_from(FlowEvent).where(FlowEvent.created_at >= now - timedelta(hours=24))
    ) or 0

    hour_ago = now - timedelta(hours=1)
    delivered = db.scalar(
        select(func.count()).select_from(WebhookDelivery)
        .where(WebhookDelivery.created_at >= hour_ago, WebhookDelivery.ok.is_(True))
    ) or 0
    failed = db.scalar(
        select(func.count()).select_from(WebhookDelivery)
        .where(WebhookDelivery.created_at >= hour_ago, WebhookDelivery.ok.is_(False))
    ) or 0
    subscriptions = db.scalars(select(WebhookSubscription)).all()

    ticks = metrics.tick_stats()
    requests = metrics.request_stats()
    alerts = []
    if metrics.uptime_seconds() > 60 and (ticks["age_seconds"] is None or ticks["age_seconds"] > 60):
        alerts.append({"level": "critical", "title": "Simulation engine stalled", "detail": "No census tick in the last minute."})
    if db_ms > 500:
        alerts.append({"level": "warning", "title": "Database is slow", "detail": f"SELECT 1 took {db_ms} ms."})
    for subscription in subscriptions:
        if not subscription.active:
            continue
        last_three = db.scalars(
            select(WebhookDelivery.ok)
            .where(WebhookDelivery.subscription_id == subscription.id)
            .order_by(WebhookDelivery.id.desc())
            .limit(3)
        ).all()
        if len(last_three) == 3 and not any(last_three):
            alerts.append({"level": "warning", "title": "Webhook failing", "detail": subscription.url})
    for row in integrations:
        if row["status"] == "silent":
            alerts.append({"level": "warning", "title": f"{row['name']} is silent", "detail": "No message in over an hour."})
        if row["status"] == "not_configured":
            alerts.append({"level": "info", "title": f"{row['name']} not configured", "detail": row["protocol"]})
    levels = {alert["level"] for alert in alerts}
    status = "outage" if "critical" in levels else "degraded" if "warning" in levels else "operational"

    return {
        "status": status,
        "generated_at": iso(now),
        "version": VERSION,
        "kpis": {
            "events_per_min": round(last_five / 5, 1),
            "messages_24h": messages_24h,
            "integrations_healthy": len(healthy),
            "integrations_total": len(connected),
            "api_p95_ms": requests["api"]["p95_ms"],
        },
        "integrations": integrations,
        "health": {
            "uptime_seconds": metrics.uptime_seconds(),
            "database": {"engine": "PostgreSQL" if "postgres" in settings.database_url else "SQL", "latency_ms": db_ms},
            "simulation": ticks,
            "requests": requests,
            "ai": {"configured": bool(settings.google_api_key), "model": _ai_model()},
            "sso": {"configured": bool(settings.auth0_domain and settings.auth0_client_id)},
        },
        "webhooks": {
            "subscriptions": len(subscriptions),
            "active": sum(1 for row in subscriptions if row.active),
            "delivered_1h": delivered,
            "failed_1h": failed,
            "success_rate": round(delivered / (delivered + failed), 3) if delivered + failed else None,
        },
        "alerts": alerts,
    }


@router.get("/events", summary="Canonical event stream (poll with ?after=<cursor>)")
def events(
    after: int | None = Query(None, ge=0),
    room: str | None = Query(None, max_length=16),
    type_prefix: str | None = Query(None, alias="type", max_length=60),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    stmt = select(FlowEvent)
    if room:
        stmt = stmt.where(FlowEvent.room_id == room)
    fetch = limit * 4 if type_prefix else limit
    if after is not None:
        rows = db.scalars(stmt.where(FlowEvent.id > after).order_by(FlowEvent.id.asc()).limit(fetch)).all()
    else:
        rows = list(reversed(db.scalars(stmt.order_by(FlowEvent.id.desc()).limit(fetch)).all()))
    out = [event_row(row) for row in rows]
    if type_prefix:
        out = [row for row in out if row["type"].startswith(type_prefix)][-limit:]
    cursor = rows[-1].id if rows else after
    return {"events": out, "cursor": cursor}


@router.get("/events/{sequence}", summary="One event as CloudEvent, HL7 v2 and FHIR")
def event_detail(sequence: int, db: Session = Depends(get_db)):
    row = db.get(FlowEvent, sequence)
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    info = classify(row.patient_name, row.message, row.kind, row.room_id)
    room = db.get(Room, row.room_id) if row.room_id else None
    dept = room.dept if room else None
    current = room.patient if room is not None else None
    same_patient = current is not None and info["patient"] and current.name == info["patient"]

    message = None
    if info["hl7"]:
        message = hl7.message(
            row.id,
            info["hl7"],
            row.created_at,
            row.room_id,
            dept,
            patient=info["patient"],
            bed_status=info["bed_status"],
            disposition=info["disposition"],
            destination=destination(row.message),
            attending=current.physician if same_patient else None,
        )

    resource = None
    if info["type"].startswith("patient.") and info["patient"]:
        if same_patient and info["type"] in ("patient.admitted", "patient.transferred"):
            resource = fhir.encounter(room, current, _now())
        else:
            resource = fhir.finished_encounter(
                row.id, info["patient"], row.room_id, dept, _aware(row.created_at), destination(row.message)
            )
    elif room is not None:
        resource = fhir.bed_location(room)

    return {"event": event_row(row, info), "cloudevent": cloud_event(row, info), "hl7": message, "fhir": resource}


# ---------- Webhooks ----------

class WebhookIn(BaseModel):
    url: str = Field(min_length=8, max_length=400)
    event_types: list[str] = Field(default_factory=list, max_length=20)
    description: str | None = Field(None, max_length=120)


class WebhookPatch(BaseModel):
    active: bool


def _subscription_payload(db: Session, row: WebhookSubscription, reveal: bool = False) -> dict:
    day_ago = _now() - timedelta(hours=24)
    delivered = db.scalar(
        select(func.count()).select_from(WebhookDelivery)
        .where(WebhookDelivery.subscription_id == row.id, WebhookDelivery.ok.is_(True), WebhookDelivery.created_at >= day_ago)
    ) or 0
    failed = db.scalar(
        select(func.count()).select_from(WebhookDelivery)
        .where(WebhookDelivery.subscription_id == row.id, WebhookDelivery.ok.is_(False), WebhookDelivery.created_at >= day_ago)
    ) or 0
    last = db.scalars(
        select(WebhookDelivery).where(WebhookDelivery.subscription_id == row.id).order_by(WebhookDelivery.id.desc()).limit(1)
    ).first()
    return {
        "id": row.id,
        "url": row.url,
        "description": row.description,
        "event_types": filters(row),
        "active": row.active,
        "secret": row.secret if reveal else mask(row.secret),
        "created_by": row.created_by,
        "created_at": iso(row.created_at),
        "delivered_24h": delivered,
        "failed_24h": failed,
        "last_delivery": _delivery_payload(last) if last else None,
    }


def _delivery_payload(row: WebhookDelivery) -> dict:
    return {
        "id": row.id,
        "event_id": row.event_id,
        "event_type": row.event_type,
        "attempt": row.attempt,
        "status_code": row.status_code,
        "ok": row.ok,
        "latency_ms": row.latency_ms,
        "error": row.error,
        "created_at": iso(row.created_at),
    }


def _get_subscription(db: Session, subscription_id: int) -> WebhookSubscription:
    row = db.get(WebhookSubscription, subscription_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Webhook subscription not found.")
    return row


@router.get("/webhooks", summary="List webhook subscriptions")
def list_webhooks(db: Session = Depends(get_db)):
    rows = db.scalars(select(WebhookSubscription).order_by(WebhookSubscription.id.desc())).all()
    return {"subscriptions": [_subscription_payload(db, row) for row in rows]}


@router.post("/webhooks", status_code=201, summary="Subscribe a URL to hospital events")
def create_webhook(body: WebhookIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    parsed = urlparse(body.url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=422, detail="Use a full http(s) URL.")
    chosen = []
    for item in body.event_types:
        name = item.strip()
        family = name[:-2] if name.endswith(".*") else None
        if name in EVENT_TYPE_NAMES or (family and any(t.startswith(family + ".") for t in EVENT_TYPE_NAMES)):
            chosen.append(name)
        elif name:
            raise HTTPException(status_code=422, detail=f"Unknown event type: {name}")
    latest = db.scalar(select(func.max(FlowEvent.id))) or 0
    row = WebhookSubscription(
        url=body.url.strip(),
        description=(body.description or "").strip() or None,
        secret=new_secret(),
        event_types=",".join(chosen),
        active=True,
        cursor_event_id=latest,
        created_by=actor,
    )
    db.add(row)
    db.commit()
    record(db, actor, "webhook.create", f"webhook:{row.id}", row.url)
    return _subscription_payload(db, row, reveal=True)


@router.patch("/webhooks/{subscription_id}", summary="Pause or resume a subscription")
def patch_webhook(subscription_id: int, body: WebhookPatch, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    row = _get_subscription(db, subscription_id)
    row.active = body.active
    if body.active:
        # Resume from now; a paused endpoint should not be flooded with the backlog.
        row.cursor_event_id = db.scalar(select(func.max(FlowEvent.id))) or row.cursor_event_id
    db.commit()
    record(db, actor, "webhook.resume" if body.active else "webhook.pause", f"webhook:{row.id}", row.url)
    return _subscription_payload(db, row)


@router.delete("/webhooks/{subscription_id}", summary="Delete a subscription and its delivery log")
def delete_webhook(subscription_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    row = _get_subscription(db, subscription_id)
    url = row.url
    db.execute(delete(WebhookDelivery).where(WebhookDelivery.subscription_id == row.id))
    db.delete(row)
    db.commit()
    record(db, actor, "webhook.delete", f"webhook:{subscription_id}", url)
    return {"deleted": subscription_id}


@router.post("/webhooks/{subscription_id}/test", summary="Send a signed test event now")
def test_webhook(subscription_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    row = _get_subscription(db, subscription_id)
    delivery = send_test(db, row)
    record(db, actor, "webhook.test", f"webhook:{row.id}", f"HTTP {delivery.status_code or 'error'}")
    return _delivery_payload(delivery)


@router.get("/webhooks/{subscription_id}/deliveries", summary="Delivery attempts for one subscription")
def webhook_deliveries(subscription_id: int, limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db)):
    _get_subscription(db, subscription_id)
    rows = db.scalars(
        select(WebhookDelivery)
        .where(WebhookDelivery.subscription_id == subscription_id)
        .order_by(WebhookDelivery.id.desc())
        .limit(limit)
    ).all()
    return {"deliveries": [_delivery_payload(row) for row in rows]}


# ---------- Sandbox receiver ----------

@router.post("/sandbox/inbox", summary="Built-in webhook receiver that verifies signatures")
async def sandbox_receive(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    try:
        subscription_id = int(request.headers.get(SUBSCRIPTION_HEADER, ""))
    except ValueError:
        subscription_id = None
    subscription = db.get(WebhookSubscription, subscription_id) if subscription_id else None
    valid = bool(subscription) and verify(subscription.secret, request.headers.get(SIGNATURE_HEADER), body)
    try:
        payload = json.loads(body or b"{}")
    except ValueError:
        payload = {}
    row = SandboxMessage(
        subscription_id=subscription_id,
        event_type=str(payload.get("type", "unknown"))[:80],
        event_id=str(payload.get("id", ""))[:40] or None,
        signature_valid=valid,
        body=body.decode("utf-8", "replace")[:20000],
    )
    db.add(row)
    db.commit()
    stale = db.scalars(select(SandboxMessage.id).order_by(SandboxMessage.id.desc()).offset(KEEP_SANDBOX)).all()
    if stale:
        db.execute(delete(SandboxMessage).where(SandboxMessage.id.in_(stale)))
        db.commit()
    return {"received": True, "verified": valid}


@router.get("/sandbox/inbox", summary="What the sandbox receiver got")
def sandbox_messages(limit: int = Query(20, ge=1, le=50), db: Session = Depends(get_db)):
    rows = db.scalars(select(SandboxMessage).order_by(SandboxMessage.id.desc()).limit(limit)).all()
    return {
        "messages": [
            {
                "id": row.id,
                "subscription_id": row.subscription_id,
                "event_type": row.event_type,
                "event_id": row.event_id,
                "signature_valid": row.signature_valid,
                "body": row.body,
                "received_at": iso(row.received_at),
            }
            for row in rows
        ]
    }


# ---------- Audit ----------

@router.get("/audit", summary="Audit trail of decisions and configuration changes")
def audit(
    limit: int = Query(100, ge=1, le=500),
    action: str | None = Query(None, max_length=40),
    db: Session = Depends(get_db),
):
    stmt = select(AuditEntry).order_by(AuditEntry.id.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditEntry.action.startswith(action))
    rows = db.scalars(stmt).all()
    return {
        "entries": [
            {
                "id": row.id,
                "actor": row.actor,
                "action": row.action,
                "target": row.target,
                "detail": row.detail,
                "created_at": iso(row.created_at),
            }
            for row in rows
        ]
    }


# ---------- Regional network ----------

PARTNER_PROFILES = {
    OUTSIDE_HOSPITAL: {"beds": 220, "base": 0.79, "phase": 0.0, "services": "Emergency · Medicine"},
    "County Trauma": {"beds": 140, "base": 0.84, "phase": 2.1, "services": "Level I trauma · ICU"},
    "Heart Center": {"beds": 90, "base": 0.72, "phase": 4.2, "services": "Cardiac surgery · OR"},
}


@router.get("/network", summary="Regional partner hospitals and transfers sent to them")
def network(db: Session = Depends(get_db)):
    now = _now()
    day_ago = now - timedelta(hours=24)
    beds = db.scalars(select(Room).where(Room.kind.in_(("bed", "or")))).all()
    occupied = sum(1 for room in beds if room.status in fhir.OCCUPIED)
    counts = dict(
        db.execute(
            select(Transfer.destination, func.count())
            .where(Transfer.created_at >= day_ago)
            .group_by(Transfer.destination)
        ).all()
    )
    diverted = db.scalar(
        select(func.count()).select_from(FlowEvent)
        .where(FlowEvent.kind == "divert", FlowEvent.room_id.is_not(None), FlowEvent.created_at >= day_ago)
    ) or 0
    counts[OUTSIDE_HOSPITAL] = counts.get(OUTSIDE_HOSPITAL, 0) + diverted

    partners = []
    minute = now.timestamp() / 60
    for name, profile in PARTNER_PROFILES.items():
        # Emulated capacity feed: a slow 40-minute swing around each hospital's usual level.
        share = min(0.99, max(0.4, profile["base"] + 0.07 * math.sin(2 * math.pi * minute / 40 + profile["phase"])))
        partners.append({
            "name": name,
            "services": profile["services"],
            "beds": profile["beds"],
            "occupancy_pct": round(share * 100),
            "open_beds": round(profile["beds"] * (1 - share)),
            "ed_status": "diverting" if share >= 0.9 else "accepting",
            "transfers_24h": counts.get(name, 0),
        })
    return {
        "source": "Regional HIE capacity feed · emulated",
        "home": {
            "name": "Tiger Memorial",
            "beds": len(beds),
            "occupancy_pct": round(occupied / len(beds) * 100) if beds else 0,
            "open_beds": sum(1 for room in beds if room.status == "available"),
        },
        "partners": partners,
    }

