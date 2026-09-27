import json
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.api.routes.insights import insights
from app import ems
from app.models import AmbulanceRun
from app.ops_snapshot import build_ops

router = APIRouter()

SYSTEM = """You are the operations assistant for Tiger Memorial Hospital and its regional ambulance network.
You help hospital staff and ambulance crews: incoming ambulances, where to send a patient, and which beds are open in every unit.
When asked where to send a patient, use "regional_availability" and "ems_routing_rules": name one hospital and say why.
Answer only from the operations snapshot in this prompt.
If the snapshot does not contain the fact, say it is not in the census.
Do not invent patients, staff, beds, times, or vital signs.
If a vital sign is missing, say it is not recorded.
Always write room ids exactly as they appear in the snapshot (for example ED-04 or ICU-03),
because the live map turns every room id in your answer into a button.
When asked where to put a patient, recommend one specific bed from "usable" and say why in one sentence.
If no bed is usable, say so and name the fastest way to open one (a clean to finish, a stable patient to discharge, or diverting).
Do not mention other screens.
Reply in the same language as the latest user message.
Keep the answer under 90 words. Use short bullet points when listing more than two things."""


BRIEFING = """You write the operations briefing for the chief executive of Tiger Memorial Hospital.
Use only the operations snapshot in this prompt. Do not invent numbers.
Write exactly three bullet lines, each under 22 words, each starting with "- ".
Line 1: whether the hospital is accepting ambulances or on diversion, and the tightest unit with its open beds.
Line 2: ambulances due in the next 15 minutes and how many pre-alerts are still unanswered.
Line 3: the one decision worth making now (answer a pre-alert, or diversion if a needed unit is full), or say no action is needed.
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


def _ems_context(db: Session) -> dict:
    """Ambulances on the way and every hospital's capacity, without patient names."""
    rows = db.scalars(select(AmbulanceRun).where(AmbulanceRun.status.in_(ems.ACTIVE)).limit(20)).all()
    runs = [ems.run_payload(run) for run in rows]
    return {
        "ambulance_status": ems.facility(db).ems_status,
        "ambulances_incoming": [
            {key: run[key] for key in ("code", "unit", "esi", "complaint_label", "status", "bed_id", "eta_seconds", "target")}
            for run in runs
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
    db.commit()
    db.close()
    brief = {
        "surge": snapshot["surge"],
        "incoming_notice": snapshot.get("incoming_notice"),
        "called_physicians": snapshot.get("called_physicians"),
        "diverted_count": snapshot.get("diverted_count"),
        "counts": snapshot["counts"],
        "items": snapshot["items"][:24],
        "usable": snapshot["usable"][:30],
        "holds": snapshot["holds"],
        "housekeepers": snapshot["housekeepers"],
        "staff": snapshot["staff"],
        "beds": snapshot.get("beds", [])[:40],
        "units": snapshot["units"],
        "pending": snapshot["pending"][:20],
        **ems_context,
    }
    messages = [{"role": turn["role"], "content": turn["content"]} for turn in turns]
    content = _complete(SYSTEM + "\n\nOperations snapshot:\n" + json.dumps(brief, default=str), messages, 2048)
    return {"reply": content.strip()}
