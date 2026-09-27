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
Do not invent patients, staff, beds, times, or vital signs.
If a vital sign is missing, say it is not recorded.
Point to the live map for the room. Do not mention other screens.
Reply in the same language as the latest user message.
Keep the answer short enough to read on one screen."""


class ChatTurn(BaseModel):
    role: str
    content: str = Field(max_length=2000)


class ChatIn(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=12)


@router.post("/chat")
def chat(body: ChatIn, db: Session = Depends(get_db)):
    if not settings.google_api_key:
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
    try:
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.google_model}:generateContent",
            headers={
                "x-goog-api-key": settings.google_api_key,
                "Content-Type": "application/json",
            },
            json={
                "system_instruction": {
                    "parts": [{
                        "text": SYSTEM + "\n\nOperations snapshot:\n" + json.dumps(brief, default=str),
                    }],
                },
                "contents": contents,
            },
            timeout=40,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="The assistant could not be reached.") from None
    data = response.json()
    if response.status_code >= 400:
        message = (data.get("error") or {}).get("message") or "The assistant could not answer."
        raise HTTPException(status_code=502, detail=message)
    parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
    content = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
    if not content.strip():
        raise HTTPException(status_code=502, detail="The assistant returned an empty answer.")
    return {"reply": content.strip()}
