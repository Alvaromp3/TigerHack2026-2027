import json
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.db import get_db
from app.api.routes.insights import insights
from app import care, ems
from app.infra.events import classify
from app.models import (
    AmbulanceRun,
    AuditEntry,
    FlowEvent,
    Housekeeper,
    Incident,
    LinenAide,
    Patient,
    Room,
    Staff,
    Transfer,
)
from app.sim import TICK_SECONDS
from app.ops_snapshot import build_ops

router = APIRouter()

SYSTEM = """You are SurgeCommand, the operations assistant of Tiger Memorial Hospital.
You talk to charge nurses, bed managers and the hospital director. You can read the hospital's live
database in this prompt: every bed and its status, the synthetic patients in them with vitals, staff on
duty and their load, housekeeping and linen turnover, ambulances on the way with ESI triage, recent
events, open incidents, and partner hospitals (their capacity is emulated).

How to answer:
- First line: the direct answer in one sentence, with the key number or bed in **bold**.
- Then at most 4 short bullets with the specifics: room ids, names, counts, minutes.
- When there is an obvious next step, end with a line that starts with "Next:" and one concrete action.
- Use only facts from the data below. If something is not there, say it is not in the live data.
  Never invent patients, rooms, staff, times or vital signs.
- Write room ids exactly as they appear (ED-04, ICU-301, FAST-2). The app turns them into buttons.
- Ambulances coming to us are exactly "ambulances_to_us": the same list, count and order as the
  Ambulances tab. For incoming ambulances, list only those. "ambulances_to_other_hospitals" is regional
  traffic going elsewhere; mention it only when asked about the region.
- Give ETAs as the countdown (eta_countdown, like the tab) or in minutes, never in seconds. A pending ambulance's bed is only suggested; no bed is
  held until someone accepts. Only people accept; unanswered crews go elsewhere when a minute out
  ("answer_within_minutes").
- Each patient's "right_now" is what is being done at this moment: in an operating room, the operation
  (with "surgeon"); elsewhere, the current step of care. Use it for "what is happening in OR-2?".
- For an ambulance or a new patient, match ESI and complaint to the open beds by unit and name the bed.
- ESI 1 is the most urgent and 5 the least. NEWS comes from vitals; 5 or more means urgent review.
- Patients are synthetic demo data: answer about operations, never give medical advice.
- Reply in the language of the latest user message. Keep it under 120 words."""


BRIEFING = """You write the operations briefing for the director of Tiger Memorial Hospital.
Use only the data in this prompt. Do not invent numbers.
Write exactly three bullet lines, each under 22 words, each starting with "- ".
Line 1: the tightest unit and its open beds, and Emergency's open beds.
Line 2: ambulances_to_us due in the next 15 minutes and how many are still waiting for our answer.
Line 3: the one decision worth making now (answer a pre-alert, finish a clean, move a stable patient), or say none is needed.
Calm, factual, management tone. No alarm words. Write room and unit names exactly as given."""

_briefing_cache: dict = {"at": 0.0, "text": None}
BRIEFING_TTL_SECONDS = 45


def _complete(system_text: str, messages: list[dict], max_tokens: int) -> str:
    payload = {
        "model": settings.openrouter_model,
        "messages": [{"role": "system", "content": system_text}, *messages],
        "temperature": 0.3,
        "max_tokens": max_tokens,
    }
    # 2.5 Flash can spend the whole budget on hidden reasoning and return nothing visible.
    if "gemini-2.5" in settings.openrouter_model:
        payload["reasoning"] = {"effort": "none"}
    try:
        response = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="The assistant could not be reached.") from None
    try:
        data = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="The assistant sent an unreadable answer.") from None
    if response.status_code >= 400:
        message = (data.get("error") or {}).get("message") or "The assistant could not answer."
        raise HTTPException(status_code=502, detail=message)
    choice = (data.get("choices") or [{}])[0]
    raw = (choice.get("message") or {}).get("content") or ""
    if isinstance(raw, list):
        raw = "".join(part.get("text", "") for part in raw if isinstance(part, dict))
    if not str(raw).strip():
        raise HTTPException(status_code=502, detail="The assistant returned an empty answer.")
    return str(raw)


TABLES = (
    ("rooms", Room, "every bed, operating room and support room with its live status"),
    ("patients", Patient, "synthetic patients in a bed, with vitals, attending and nurse"),
    ("staff", Staff, "physicians, nurses and charge nurses with shift and extension"),
    ("housekeepers", Housekeeper, "environmental services crew and the room each is cleaning"),
    ("linen_aides", LinenAide, "linen crew and the room each is serving"),
    ("ambulance_runs", AmbulanceRun, "ambulance pre-alerts, answers, arrivals and handoffs"),
    ("flow_events", FlowEvent, "every admission, move, discharge, clean and ambulance event"),
    ("incidents", Incident, "beds taken out of service"),
    ("transfers", Transfer, "patients sent to partner hospitals"),
    ("audit_entries", AuditEntry, "who made each decision in the app"),
)


def _minutes(ticks) -> int:
    return round((ticks or 0) * TICK_SECONDS / 60)


def _database_context(db: Session) -> dict:
    """The live database, shaped for the assistant: counts, units, patients, turnover, staff, events."""
    now = datetime.now(timezone.utc)
    rooms = db.scalars(select(Room).options(selectinload(Room.patient)).order_by(Room.id)).all()
    census = [room for room in rooms if room.kind in ("bed", "or")]
    cleaners = {keeper.room_id: keeper.name for keeper in db.scalars(select(Housekeeper)).all() if keeper.room_id}
    aides = {aide.room_id: aide.name for aide in db.scalars(select(LinenAide)).all() if aide.room_id}

    status_by_unit: dict[str, Counter] = defaultdict(Counter)
    open_beds: dict[str, list[str]] = defaultdict(list)
    for room in census:
        status_by_unit[room.dept][room.status] += 1
        if room.status == "available" and room.patient is None:
            open_beds[room.dept].append(room.id)

    activities = care.by_patient(db)
    patients = []
    for room in census:
        patient = room.patient
        if patient is None:
            continue
        now_doing = care.payload(activities.get(patient.id), room.id)
        patients.append({
            "room": room.id,
            "floor": room.floor_id,
            "unit": room.dept,
            "name": patient.name,
            # The operation in theatre (kind "surgery") or the current step of care, with its start time.
            "right_now": {
                "what": now_doing["activity"],
                "kind": now_doing["activity_kind"],
                "since": now_doing["activity_started_at"],
            } if now_doing["activity"] else None,
            "surgeon": patient.physician if now_doing["activity_kind"] == "surgery" else None,
            "age": patient.age,
            "acuity": patient.acuity,
            "complaint": patient.chief_complaint,
            "diagnosis": patient.diagnosis,
            "vitals": {
                "hr": patient.heart_rate,
                "bp": f"{patient.systolic}/{patient.diastolic}" if patient.systolic and patient.diastolic else None,
                "spo2": patient.spo2,
                "rr": patient.respiratory_rate,
                "temp_c": patient.temperature / 10 if patient.temperature else None,
            },
            "attending": patient.physician,
            "nurse": patient.nurse,
            "minutes_in_bed": _minutes(patient.stay_ticks),
            "needs_or": patient.needs_or,
        })

    turnover = [
        {
            "room": room.id,
            "clean": "done" if room.ticks_left == 0 else f"~{_minutes(room.ticks_left)} min left",
            "housekeeper": cleaners.get(room.id),
            "linen": room.linen_stage,
            "linen_aide": aides.get(room.id),
            "held_for": room.hold_for,
        }
        for room in census
        if room.status == "cleaning"
    ]
    holds = [{"room": room.id, "held_for": room.hold_for} for room in census if room.status == "reserved"]
    incidents = [
        {"room": row.room_id, "title": row.title, "severity": row.severity}
        for row in db.scalars(select(Incident).where(Incident.status == "open")).all()
    ]
    events = []
    for row in db.scalars(select(FlowEvent).order_by(FlowEvent.id.desc()).limit(20)).all():
        info = classify(row.patient_name, row.message, row.kind, row.room_id)
        stamp = row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc)
        events.append({"minutes_ago": round((now - stamp).total_seconds() / 60, 1), "type": info["type"], "message": row.message})

    return {
        "generated_at": now.isoformat(),
        "database": {
            "engine": "PostgreSQL",
            "tables": [
                {"table": name, "rows": db.scalar(select(func.count()).select_from(model)) or 0, "holds": about}
                for name, model, about in TABLES
            ],
        },
        "units": {
            unit: {"statuses": dict(counts), "open_bed_ids": open_beds.get(unit, [])}
            for unit, counts in status_by_unit.items()
        },
        "patients": patients,
        "turnover": turnover,
        "holds": holds,
        "open_incidents": incidents,
        "recent_events": events,
        "flow_last_2h": insights(minutes=120, bucket=10, db=db)["totals"],
        "discharges_last_24h": db.scalar(
            select(func.count()).select_from(FlowEvent)
            .where(FlowEvent.kind == "discharge", FlowEvent.created_at >= now - timedelta(hours=24))
        ) or 0,
        "staff_on_duty": db.scalar(select(func.count()).select_from(Staff).where(Staff.on_duty.is_(True))) or 0,
    }


RUN_STATE = {
    "pending": "waiting for our answer",
    "accepted": "accepted, bed held",
    "arrived": "at the EMS bay",
}


# Same countdown the Ambulances tab shows (m:ss). The server does not know the viewer's time zone.
def _eta(run: dict) -> dict:
    seconds = max(0, int(run["eta_seconds"] or 0))
    return {"eta_minutes": round(seconds / 60, 1), "eta_countdown": f"{seconds // 60}:{seconds % 60:02d}"}


def _ems_context(db: Session) -> dict:
    """Ambulances on the way and every hospital's capacity, without patient names."""
    # Exactly the Ambulances tab: to this hospital, still active, soonest first.
    ours = db.scalars(
        select(AmbulanceRun)
        .where(AmbulanceRun.destination == ems.HOME, AmbulanceRun.status.in_(ems.ACTIVE))
        .order_by(AmbulanceRun.eta_at.asc())
        .limit(40)
    ).all()
    elsewhere = db.scalars(
        select(AmbulanceRun)
        .where(AmbulanceRun.destination != ems.HOME, AmbulanceRun.status.in_(ems.ACTIVE))
        .order_by(AmbulanceRun.eta_at.asc())
        .limit(12)
    ).all()
    to_us = []
    for run in map(ems.run_payload, ours):
        row = {
            **{key: run[key] for key in ("code", "unit", "agency", "esi", "complaint_label", "summary", "bed_id", "zone")},
            "state": RUN_STATE.get(run["status"], run["status"]),
            **_eta(run),
            "field_vitals": run["vitals"],
            "needs": run["needs"],
        }
        if run["status"] == "pending":
            row["bed_id_meaning"] = "suggested, not held yet"
            row["answer_within_minutes"] = round(max(0, (run["eta_seconds"] or 0) - ems.NO_ANSWER_LEAD_SECONDS) / 60, 1)
        to_us.append(row)
    return {
        "home_capacity": ems.home_capacity(db),
        "ambulance_status": ems.facility(db).ems_status,
        "ambulances_to_us": to_us,
        "ambulances_to_us_count": len(to_us),
        "ambulances_to_other_hospitals": [
            {"unit": run["unit"], "hospital": run["destination"], "esi": run["esi"], "complaint_label": run["complaint_label"], **_eta(run)}
            for run in map(ems.run_payload, elsewhere)
        ],
        "ambulance_kpis": ems.summary(db),
        "regional_availability": [
            {
                "hospital": row["name"],
                "ems_status": row["ems_status"],
                "services": row["services"],
                "open_beds": {unit: data["open"] for unit, data in row["units"].items()},
                "ed_wait_min": row["ed_wait_min"],
            }
            for row in ems.network(db)
        ],
        "ems_routing_rules": "Trauma ESI 1-3 needs a trauma center (Level I preferred for ESI 1-2); stroke needs a stroke "
        "center with CT; STEMI ESI 1-2 needs a cath lab; ESI 1-2 respiratory, stroke, cardiac or trauma needs an open ICU bed; "
        "hospitals on diversion are skipped except ESI 1 to the nearest capable hospital.",
    }


class ChatTurn(BaseModel):
    role: str
    content: str = Field(max_length=2000)


class ChatIn(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=12)


@router.get("/chat/status")
def chat_status():
    """Lets the team check that OPENROUTER_API_KEY is loaded, without exposing it."""
    return {
        "configured": bool(settings.openrouter_api_key),
        "model": settings.openrouter_model,
    }


@router.get("/briefing")
def briefing(db: Session = Depends(get_db)):
    """Three-line executive summary. Cached briefly so every open screen shares one call."""
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="The assistant is not configured.")
    now = time.monotonic()
    if _briefing_cache["text"] and now - _briefing_cache["at"] < BRIEFING_TTL_SECONDS:
        return {"briefing": _briefing_cache["text"], "cached": True}
    snapshot = build_ops(db)
    trends = insights(minutes=120, bucket=10, db=db)
    brief = {
        "counts": snapshot["counts"],
        "units": snapshot["units"],
        "holds": snapshot["holds"],
        "items": snapshot["items"][:12],
        "staff_load": [
            {"name": person["name"], "role": person["role"], "unit": person["unit"], "patients": len(person["patients"])}
            for person in snapshot["staff"]
            if person["on_duty"]
        ],
        "flow_last_2h": trends["totals"],
        "bed_turnover_minutes": trends["turnover"],
        "length_of_stay_minutes": trends["los"],
        **_ems_context(db),
        "open_beds_by_unit": {unit: data["open_bed_ids"] for unit, data in _database_context(db)["units"].items()},
    }
    text = _complete(
        BRIEFING + "\n\nSnapshot:\n" + json.dumps(brief, default=str),
        [{"role": "user", "content": "Write this hour's briefing."}],
        1536,
    ).strip()
    _briefing_cache.update(at=now, text=text)
    return {"briefing": text, "cached": False}


@router.post("/chat")
def chat(body: ChatIn, db: Session = Depends(get_db)):
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="The assistant is not configured.")
    turns = []
    for turn in body.messages[-12:]:
        if turn.role not in {"user", "assistant"} or not turn.content.strip():
            continue
        turns.append({"role": turn.role, "content": turn.content.strip()})
    # Gemini requires the conversation to open with a user turn.
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    if not turns or turns[-1]["role"] != "user":
        raise HTTPException(status_code=422, detail="Send a question.")

    snapshot = build_ops(db)
    ems_context = _ems_context(db)
    database = _database_context(db)
    db.commit()
    db.close()
    brief = {
        **database,
        "capacity_by_unit": ems_context.pop("home_capacity", None),
        "called_physicians": snapshot.get("called_physicians"),
        "open_items": snapshot["items"][:24],
        "unit_staffing": snapshot["units"],
        "staff": [
            {key: person[key] for key in ("name", "role", "unit", "specialty", "shift", "extension")}
            | {"patients": len(person["patients"])}
            for person in snapshot["staff"]
            if person["on_duty"]
        ],
        "housekeepers": snapshot["housekeepers"],
        "waiting_for_a_bed": snapshot["pending"][:20],
        **ems_context,
    }
    messages = [{"role": turn["role"], "content": turn["content"]} for turn in turns]
    content = _complete(SYSTEM + "\n\nOperations snapshot:\n" + json.dumps(brief, default=str), messages, 2048)
    return {"reply": content.strip()}
