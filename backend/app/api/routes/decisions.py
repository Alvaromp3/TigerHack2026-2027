"""Hospital-level decisions. Each one changes the live census and leaves an audit row."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.census import _state_payload
from app.db import get_db
from app.infra.audit import get_actor, record
from app.models import HospitalState
from app.sim import OUTSIDE_HOSPITAL, call_physicians, divert_overflow, reset_demo

router = APIRouter()


@router.post("/decisions/on-call", summary="Bring the on-call physicians on duty")
def decide_on_call(db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    try:
        called = call_physicians(db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    record(db, actor, "decision.on_call", "workforce", f"{called} on-call physicians on duty")
    state = db.get(HospitalState, 1)
    return {"called": called, **_state_payload(db, state)}


@router.post("/decisions/transfer-overflow", summary="Transfer Emergency overflow to a partner hospital")
def decide_transfer_overflow(db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    try:
        diverted = divert_overflow(db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    record(db, actor, "decision.transfer_out", OUTSIDE_HOSPITAL, f"{diverted} Emergency patients transferred")
    state = db.get(HospitalState, 1)
    return {"diverted": diverted, **_state_payload(db, state)}


@router.post("/surge/physicians", include_in_schema=False)
def physicians(db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    return decide_on_call(db, actor)


@router.post("/surge/divert", include_in_schema=False)
def divert(db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    return decide_transfer_overflow(db, actor)


@router.post("/demo/reset", include_in_schema=False)
def demo_reset(db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    try:
        room_id = reset_demo(db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    record(db, actor, "scenario.reset", room_id, "Demo scenario reset")
    state = db.get(HospitalState, 1)
    return {"room_id": room_id, **_state_payload(db, state)}
