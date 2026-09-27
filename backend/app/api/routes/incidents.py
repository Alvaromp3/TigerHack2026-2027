from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Incident
from app.sim import open_incident, resolve_incident

router = APIRouter()


class IncidentIn(BaseModel):
    room_id: str = Field(min_length=1, max_length=16)
    title: str = Field(min_length=1, max_length=200)
    severity: str = "high"


def _payload(row: Incident) -> dict:
    return {
        "id": row.id,
        "room_id": row.room_id,
        "title": row.title,
        "severity": row.severity,
        "status": row.status,
        "baseline_status": row.baseline_status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
    }


@router.get("/incidents")
def list_incidents(db: Session = Depends(get_db)):
    rows = db.scalars(select(Incident).order_by(Incident.id.desc()).limit(40)).all()
    return {"incidents": [_payload(row) for row in rows]}


@router.post("/incidents")
def create_incident(body: IncidentIn, db: Session = Depends(get_db)):
    message, incident_id = open_incident(db, body.room_id, body.title, body.severity)
    if message:
        raise HTTPException(status_code=409, detail=message)
    row = db.get(Incident, incident_id)
    return _payload(row)


@router.post("/incidents/{incident_id}/resolve")
def close_incident(incident_id: int, db: Session = Depends(get_db)):
    message = resolve_incident(db, incident_id)
    if message:
        raise HTTPException(status_code=409, detail=message)
    row = db.get(Incident, incident_id)
    return _payload(row)
