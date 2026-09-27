"""Signed webhook delivery of hospital events.

Each subscription keeps a cursor into flow_events. Every few seconds the dispatcher pushes the
next events as CloudEvents JSON, signed Stripe-style with HMAC-SHA256, and records every attempt.
"""

import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.infra.events import TYPE_PREFIX, classify, cloud_event, test_event
from app.models import FlowEvent, WebhookDelivery, WebhookSubscription

SIGNATURE_HEADER = "X-SurgeCommand-Signature"
SUBSCRIPTION_HEADER = "X-SurgeCommand-Subscription"
BATCH = 20
MAX_ATTEMPTS = 3
TIMEOUT_SECONDS = 4.0
TOLERANCE_SECONDS = 300
KEEP_DELIVERIES = timedelta(hours=24)


def new_secret() -> str:
    return "whsec_" + secrets.token_urlsafe(24)


def mask(secret: str) -> str:
    return f"{secret[:9]}…{secret[-4:]}"


def sign(secret: str, body: bytes, stamp: int | None = None) -> str:
    stamp = int(time.time()) if stamp is None else stamp
    digest = hmac.new(secret.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"


def verify(secret: str, header: str | None, body: bytes, now: int | None = None) -> bool:
    """Check a signature header the way a receiving system should."""
    if not header:
        return False
    parts = dict(item.split("=", 1) for item in header.split(",") if "=" in item)
    try:
        stamp = int(parts.get("t", ""))
    except ValueError:
        return False
    now = int(time.time()) if now is None else now
    if abs(now - stamp) > TOLERANCE_SECONDS:
        return False
    expected = sign(secret, body, stamp).split("v1=", 1)[1]
    return hmac.compare_digest(expected, parts.get("v1", ""))


def filters(subscription: WebhookSubscription) -> list[str]:
    return [item.strip() for item in (subscription.event_types or "").split(",") if item.strip()]


def wants(subscription: WebhookSubscription, event_type: str) -> bool:
    chosen = filters(subscription)
    if not chosen:
        return True
    return any(
        event_type == item or (item.endswith(".*") and event_type.startswith(item[:-1]))
        for item in chosen
    )


def _post(subscription: WebhookSubscription, envelope: dict) -> tuple[int | None, bool, int, str | None]:
    body = json.dumps(envelope, separators=(",", ":")).encode()
    headers = {
        "Content-Type": "application/cloudevents+json",
        "User-Agent": "SurgeCommand-Webhooks/1.0",
        SIGNATURE_HEADER: sign(subscription.secret, body),
        SUBSCRIPTION_HEADER: str(subscription.id),
    }
    started = time.perf_counter()
    try:
        response = httpx.post(subscription.url, content=body, headers=headers, timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as exc:
        latency = int((time.perf_counter() - started) * 1000)
        return None, False, latency, type(exc).__name__
    latency = int((time.perf_counter() - started) * 1000)
    ok = 200 <= response.status_code < 300
    return response.status_code, ok, latency, None if ok else f"HTTP {response.status_code}"


def deliver(db: Session, subscription: WebhookSubscription, envelope: dict, event_id: int | None, attempt: int) -> WebhookDelivery:
    status, ok, latency, error = _post(subscription, envelope)
    row = WebhookDelivery(
        subscription_id=subscription.id,
        event_id=event_id,
        event_type=envelope["type"].removeprefix(TYPE_PREFIX),
        attempt=attempt,
        status_code=status,
        ok=ok,
        latency_ms=latency,
        error=error,
    )
    db.add(row)
    db.flush()
    return row


def send_test(db: Session, subscription: WebhookSubscription) -> WebhookDelivery:
    row = deliver(db, subscription, test_event(datetime.now(timezone.utc), subscription.id), None, 1)
    db.commit()
    return row


def dispatch_pending() -> int:
    """Push pending events to every active subscription. Runs off the event loop thread, so a
    subscription pointing at this same server (the sandbox) can be answered while we wait."""
    sent = 0
    with SessionLocal() as db:
        subscriptions = db.scalars(select(WebhookSubscription).where(WebhookSubscription.active.is_(True))).all()
        for subscription in subscriptions:
            rows = db.scalars(
                select(FlowEvent)
                .where(FlowEvent.id > subscription.cursor_event_id)
                .order_by(FlowEvent.id)
                .limit(BATCH)
            ).all()
            for row in rows:
                info = classify(row.patient_name, row.message, row.kind, row.room_id)
                if not wants(subscription, info["type"]):
                    subscription.cursor_event_id = row.id
                    continue
                tried = db.scalar(
                    select(func.count())
                    .select_from(WebhookDelivery)
                    .where(WebhookDelivery.subscription_id == subscription.id, WebhookDelivery.event_id == row.id)
                ) or 0
                delivery = deliver(db, subscription, cloud_event(row, info), row.id, tried + 1)
                sent += 1
                if delivery.ok or tried + 1 >= MAX_ATTEMPTS:
                    subscription.cursor_event_id = row.id
                else:
                    break  # retry this event on the next cycle, keep order
            db.commit()
        db.execute(
            delete(WebhookDelivery)
            .where(WebhookDelivery.created_at < datetime.now(timezone.utc) - KEEP_DELIVERIES)
            .execution_options(synchronize_session=False)
        )
        db.commit()
    return sent
