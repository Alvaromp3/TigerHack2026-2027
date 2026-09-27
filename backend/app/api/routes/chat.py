import json
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.api.routes.insights import insights
from app.ops_snapshot import build_ops

router = APIRouter()

SYSTEM = """You are the operations assistant for the president of Tiger Memorial Hospital.
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
Use only the operations snapshot and the flow trends in this prompt. Do not invent numbers.
Write exactly three bullet lines, each under 22 words, each starting with "- ".
Line 1: capacity (occupancy, open beds, the fullest unit).
Line 2: patient flow (admissions versus discharges, bed turnover).
Line 3: the one decision worth making now, or say no action is needed.
Calm, factual, management tone. No alarm words. Write room and unit names exactly as given."""

_briefing_cache: dict = {"at": 0.0, "text": None}
BRIEFING_TTL_SECONDS = 45


# Google retires models for new keys without notice. Try the configured model first,
# then newer fallbacks, and remember whichever one answered.
FALLBACK_MODELS = ("gemini-3.8-flash", "gemini-flash-latest")
_working_model: dict = {"name": None}


def _model_candidates() -> list[str]:
    names = [_working_model["name"], settings.google_model, *FALLBACK_MODELS]
    return [name for index, name in enumerate(names) if name and name not in names[:index]]


def _retired(status: int, message: str) -> bool:
    text = message.lower()
    return status in {400, 403, 404} and any(
        marker in text for marker in ("no longer available", "not found", "is not supported", "deprecated")
    )


def _gemini(system_text: str, contents: list[dict], max_tokens: int) -> str:
    last_error = "The assistant could not answer."
    for model in _model_candidates():
        config = {"temperature": 0.3, "maxOutputTokens": max_tokens}
        if model.startswith("gemini-2.5"):
            # 2.5 Flash can skip thinking entirely, which keeps answers fast.
            config["thinkingConfig"] = {"thinkingBudget": 0}
        try:
            response = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={
                    "x-goog-api-key": settings.google_api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "system_instruction": {"parts": [{"text": system_text}]},
                    "contents": contents,
                    "generationConfig": config,
                },
                timeout=60,
            )
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="The assistant could not be reached.") from None
        try:
            data = response.json()
        except ValueError:
            raise HTTPException(status_code=502, detail="The assistant sent an unreadable answer.") from None
        if response.status_code >= 400:
            last_error = (data.get("error") or {}).get("message") or last_error
            if _retired(response.status_code, last_error):
                continue
            raise HTTPException(status_code=502, detail=last_error)
        parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
        # Thinking models may return thought parts; only keep the visible answer.
        content = "".join(
            part.get("text", "") for part in parts if isinstance(part, dict) and not part.get("thought")
        )
        if not content.strip():
            raise HTTPException(status_code=502, detail="The assistant returned an empty answer.")
        _working_model["name"] = model
        return content
    raise HTTPException(status_code=502, detail=last_error)


class ChatTurn(BaseModel):
    role: str
    content: str = Field(max_length=2000)


class ChatIn(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=12)


@router.get("/chat/status")
def chat_status():
    """Lets the team check on Render that GOOGLE_API_KEY is loaded, without exposing it."""
    return {
        "configured": bool(settings.google_api_key),
        "model": _working_model["name"] or settings.google_model,
        "candidates": _model_candidates(),
    }


@router.get("/briefing")
def briefing(db: Session = Depends(get_db)):
    """Three-line executive summary. Cached briefly so every open screen shares one call."""
    if not settings.google_api_key:
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
    }
    text = _gemini(
        BRIEFING + "\n\nSnapshot:\n" + json.dumps(brief, default=str),
        [{"role": "user", "parts": [{"text": "Write this hour's briefing."}]}],
        1536,
    ).strip()
    _briefing_cache.update(at=now, text=text)
    return {"briefing": text, "cached": False}


@router.post("/chat")
def chat(body: ChatIn, db: Session = Depends(get_db)):
    if not settings.google_api_key:
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
    }
    contents = [
        {
            "role": "user" if turn["role"] == "user" else "model",
            "parts": [{"text": turn["content"]}],
        }
        for turn in turns
    ]
    content = _gemini(SYSTEM + "\n\nOperations snapshot:\n" + json.dumps(brief, default=str), contents, 2048)
    return {"reply": content.strip()}
