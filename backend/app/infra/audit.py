"""Who did what, and when. Every decision made through the API leaves one row."""

import re
from urllib.parse import unquote

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditEntry

DEFAULT_ACTOR = "Command center"
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def get_actor(request: Request) -> str:
    """FastAPI dependency: the signed-in user's name, sent by the console as X-Actor.

    The console URL-encodes the name so non-Latin characters survive HTTP headers. The header
    is trusted as-is for the hackathon; production would read it from a verified Auth0 token.
    """
    raw = unquote(request.headers.get("x-actor", ""))
    name = _CONTROL.sub("", raw).strip()[:80]
    return name or DEFAULT_ACTOR


def record(db: Session, actor: str, action: str, target: str | None = None, detail: str | None = None) -> None:
    db.add(AuditEntry(
        actor=actor[:80],
        action=action[:40],
        target=(target or "")[:40] or None,
        detail=(detail or "")[:240] or None,
    ))
    db.commit()
