"""Executive trends: patient flow over time, bed turnover, and length of stay."""

from datetime import datetime, timedelta, timezone
from statistics import median

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import FlowEvent, Room
from app.sim import TICK_SECONDS

router = APIRouter()

# Messages that mean a bed was just vacated (see sim.py _log calls).
VACATED = (" discharged from ", " sent to ", " diverted from ", " died in ")


def _bucket_kind(kind: str) -> str | None:
    if kind == "admit":
        return "admit"
    if kind == "discharge":
        return "discharge"
    if kind in {"transfer", "divert"}:
        return "transfer"
    return None


def _aware(stamp: datetime) -> datetime:
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


@router.get("/insights")
def insights(
    minutes: int = Query(120, ge=30, le=720),
    bucket: int = Query(10, ge=5, le=60),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=minutes)
    rows = db.execute(
        select(FlowEvent.patient_name, FlowEvent.kind, FlowEvent.message, FlowEvent.room_id, FlowEvent.created_at)
        .where(FlowEvent.created_at >= since)
        .order_by(FlowEvent.created_at)
    ).all()

    slots = max(1, minutes // bucket)
    series = [
        {
            "start": (since + timedelta(minutes=bucket * index)).isoformat(),
            "admit": 0,
            "discharge": 0,
            "transfer": 0,
        }
        for index in range(slots)
    ]
    vacated_at: dict[str, datetime] = {}
    turnovers: list[float] = []

    for name, kind, message, room_id, created_at in rows:
        if created_at is None:
            continue
        stamp = _aware(created_at)
        bucket_kind = _bucket_kind(kind)
        # Command notes (e.g. "Incoming: ...") are not patient movements.
        if bucket_kind and name != "Command":
            index = min(slots - 1, max(0, int((stamp - since).total_seconds() // (bucket * 60))))
            series[index][bucket_kind] += 1
        if not room_id:
            continue
        text = f" {message or ''} "
        if any(marker in text for marker in VACATED):
            vacated_at[room_id] = stamp
        elif kind == "clean" and " is open" in text and room_id in vacated_at:
            turnovers.append((stamp - vacated_at.pop(room_id)).total_seconds() / 60)

    totals = {key: sum(slot[key] for slot in series) for key in ("admit", "discharge", "transfer")}

    rooms = db.scalars(select(Room).options(selectinload(Room.patient))).all()
    by_dept: dict[str, list[float]] = {}
    longest = []
    for room in rooms:
        patient = room.patient
        if patient is None:
            continue
        stay = (patient.stay_ticks or 0) * TICK_SECONDS / 60
        by_dept.setdefault(room.dept, []).append(stay)
        longest.append({
            "patient": patient.name,
            "room_id": room.id,
            "floor_id": room.floor_id,
            "dept": room.dept,
            "minutes": round(stay, 1),
            "diagnosis": patient.diagnosis,
        })
    longest.sort(key=lambda row: row["minutes"], reverse=True)

    return {
        "window_minutes": minutes,
        "bucket_minutes": bucket,
        "series": series,
        "totals": totals,
        "turnover": {
            "avg_minutes": round(sum(turnovers) / len(turnovers), 1) if turnovers else None,
            "median_minutes": round(median(turnovers), 1) if turnovers else None,
            "samples": len(turnovers),
        },
        "los": sorted(
            (
                {"dept": dept, "avg_minutes": round(sum(stays) / len(stays), 1), "patients": len(stays)}
                for dept, stays in by_dept.items()
            ),
            key=lambda row: row["avg_minutes"],
            reverse=True,
        ),
        "longest": longest[:6],
    }
