"""Ambulance pre-alerts and the hospital's answer. Every decision is audited."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ems
from app.db import get_db
from app.infra.audit import get_actor, record
from app.models import AmbulanceRun

router = APIRouter()


class RunIn(BaseModel):
    esi: int = Field(ge=1, le=5)
    complaint: str = Field(pattern="^(trauma|stroke|cardiac|respiratory|general)$")
    zone: str = Field(min_length=2, max_length=24)
    destination: str = Field(ems.HOME, max_length=80)
    summary: str | None = Field(None, max_length=200)


class AcceptIn(BaseModel):
    bed_id: str | None = Field(None, max_length=16)


class DivertIn(BaseModel):
    to: str | None = Field(None, max_length=80)


class StatusIn(BaseModel):
    ems_status: str = Field(pattern="^(accepting|diverting)$")
    reason: str | None = Field(None, max_length=160)


def _run(db: Session, run_id: int) -> AmbulanceRun:
    run = db.get(AmbulanceRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Ambulance run not found.")
    return run


@router.get("/runs", summary="Ambulance runs to this hospital (active by default)")
def list_runs(
    active: bool = True,
    scope: str = Query("home", pattern="^(home|region)$"),
    limit: int = Query(40, ge=1, le=200),
    db: Session = Depends(get_db),
):
    stmt = select(AmbulanceRun).order_by(AmbulanceRun.eta_at.asc() if active else AmbulanceRun.id.desc()).limit(limit)
    if scope == "home":
        stmt = stmt.where(AmbulanceRun.destination == ems.HOME)
    if active:
        stmt = stmt.where(AmbulanceRun.status.in_(ems.ACTIVE) | (
            (AmbulanceRun.status == "diverted") & AmbulanceRun.handed_off_at.is_(None)
        ))
    return {"runs": [ems.run_payload(run) for run in db.scalars(stmt).all()]}


@router.get("/runs/{run_id}", summary="One ambulance run")
def get_run(run_id: int, db: Session = Depends(get_db)):
    return ems.run_payload(_run(db, run_id))


@router.post("/runs", status_code=201, summary="Send a pre-alert from an ambulance")
def create_run(body: RunIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    try:
        run = ems.create_run(
            db,
            esi=body.esi,
            complaint=body.complaint,
            zone=body.zone,
            destination=body.destination,
            summary=body.summary,
            actor=actor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    record(db, actor, "ems.prealert", run.code, f"ESI {run.esi} {run.complaint} → {run.destination}")
    return ems.run_payload(run)


@router.post("/runs/{run_id}/accept", summary="Accept a pre-alert and hold a bed")
def accept_run(run_id: int, body: AcceptIn | None = None, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    run = _run(db, run_id)
    try:
        run = ems.accept(db, run, body.bed_id if body else None, actor)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    record(db, actor, "ems.accept", run.code, f"{run.unit} → bed {run.bed_id}")
    return ems.run_payload(run)


@router.post("/runs/{run_id}/divert", summary="Divert an incoming ambulance to a partner hospital")
def divert_run(run_id: int, body: DivertIn | None = None, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    run = _run(db, run_id)
    try:
        run = ems.divert(db, run, body.to if body else None, actor)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    record(db, actor, "ems.divert", run.code, f"{run.unit} → {run.diverted_to}")
    return ems.run_payload(run)


@router.post("/runs/{run_id}/handoff", summary="Patient handed off from the ambulance to the bed")
def handoff_run(run_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    run = _run(db, run_id)
    try:
        run = ems.handoff(db, run, actor)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    record(db, actor, "ems.handoff", run.code, f"{run.patient_name} in {run.bed_id}")
    return ems.run_payload(run)


@router.get("/status", summary="This hospital's public ambulance status")
def get_status(db: Session = Depends(get_db)):
    row = ems.facility(db)
    return {
        "ems_status": row.ems_status,
        "reason": row.reason,
        "updated_by": row.updated_by,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.post("/status", summary="Accept ambulances or go on diversion")
def set_status(body: StatusIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    row = ems.set_status(db, body.ems_status, body.reason, actor)
    record(db, actor, f"ems.{body.ems_status}", ems.HOME, row.reason)
    return get_status(db)


@router.get("/summary", summary="Ambulance KPIs for the last 24 hours")
def get_summary(db: Session = Depends(get_db)):
    return ems.summary(db)


@router.get("/recommend", summary="Rank hospitals for one patient")
def recommend(
    esi: int = Query(..., ge=1, le=5),
    complaint: str = Query(..., pattern="^(trauma|stroke|cardiac|respiratory|general)$"),
    zone: str = Query(..., max_length=24),
    db: Session = Depends(get_db),
):
    try:
        return {"options": ems.recommend(db, esi, complaint, zone)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
