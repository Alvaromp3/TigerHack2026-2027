"""Public availability database for ambulance companies. No patient data, open to any origin."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ems
from app.db import get_db
from app.models import AmbulanceRun

router = APIRouter()


def _open(response: Response) -> None:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "public, max-age=5"


@router.get("/availability", summary="Live capacity and ambulance status for every hospital in the region")
def availability(response: Response, db: Session = Depends(get_db)):
    _open(response)
    return {
        "region": "Tiger Region",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "zones": [{"name": name, "x": x, "y": y} for name, (x, y) in ems.ZONES.items()],
        "hospitals": ems.network(db),
    }


@router.get("/route", summary="Where should this ambulance go?")
def route(
    response: Response,
    esi: int = Query(..., ge=1, le=5, description="Emergency Severity Index, 1 (most urgent) to 5"),
    complaint: str = Query(..., pattern="^(trauma|stroke|cardiac|respiratory|general)$"),
    zone: str = Query(..., max_length=24, description="Pickup zone: Downtown, North, East, South or West"),
    db: Session = Depends(get_db),
):
    _open(response)
    try:
        return {"esi": esi, "complaint": complaint, "zone": zone, "options": ems.recommend(db, esi, complaint, zone)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.get("/traffic", summary="Ambulances on the road right now (positions only, no patient data)")
def traffic(response: Response, db: Session = Depends(get_db)):
    _open(response)
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(AmbulanceRun).where(
            AmbulanceRun.status.in_(("pending", "accepted")) | (
                (AmbulanceRun.status == "diverted") & AmbulanceRun.handed_off_at.is_(None)
            )
        )
    ).all()
    out = []
    for run in rows:
        payload = ems.run_payload(run, now)
        out.append({
            "code": payload["code"],
            "unit": payload["unit"],
            "esi": payload["esi"],
            "target": payload["target"],
            "status": payload["status"],
            "eta_seconds": payload["eta_seconds"],
            "created_at": payload["created_at"],
            "eta_at": payload["eta_at"],
            "route": payload["route"],
        })
    return {"ambulances": out}
