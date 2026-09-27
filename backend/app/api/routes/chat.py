import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.ops_snapshot import build_ops

router = APIRouter()

SYSTEM = """You are the operations assistant for the president of Tiger Memorial Hospital.
Answer only from the operations snapshot in this prompt.
If the snapshot does not contain the fact, say it is not in the census.
Do not invent patients, staff, beds, or times.
Do not claim you changed the hospital. Point to Command, Staff, or Incidents for the button.
Reply in the same language as the latest user message.
Keep the answer short enough to read on one screen."""


class ChatTurn(BaseModel):
    role: str
    content: str = Field(max_length=2000)


class ChatIn(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=12)


@router.post("/chat")
def chat(body: ChatIn, db: Session = Depends(get_db)):
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="The assistant is not configured.")
    turns = []
    for turn in body.messages[-12:]:
        if turn.role not in {"user", "assistant"} or not turn.content.strip():
            continue
        turns.append({"role": turn.role, "content": turn.content.strip()})
    if not turns or turns[-1]["role"] != "user":
        raise HTTPException(status_code=422, detail="Send a question.")

    snapshot = build_ops(db)
    brief = {
        "surge": snapshot["surge"],
        "counts": snapshot["counts"],
        "items": snapshot["items"][:24],
        "usable": snapshot["usable"][:30],
        "holds": snapshot["holds"],
        "housekeepers": snapshot["housekeepers"],
        "staff": snapshot["staff"],
        "units": snapshot["units"],
        "pending": snapshot["pending"][:20],
    }
    payload = {
        "model": settings.openrouter_model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "system", "content": "Operations snapshot:\n" + json.dumps(brief, default=str)},
            *turns,
        ],
    }
    try:
        response = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=40,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="The assistant could not be reached.") from None
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="The assistant could not answer.")
    data = response.json()
    choices = data.get("choices") or []
    message = (choices[0].get("message") or {}) if choices else {}
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=502, detail="The assistant returned an empty answer.")
    return {"reply": content.strip()}
