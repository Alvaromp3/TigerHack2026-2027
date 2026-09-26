from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import FlowEvent, HospitalState, Room, Transfer
from app.sim import declare_surge

router = APIRouter()


def _room_payload(room: Room):
    patient = room.patient
    return {
        "id": room.id,
        "floor_id": room.floor_id,
        "kind": room.kind,
        "dept": room.dept,
        "status": room.status,
        "surge": room.surge,
        "patient": patient.name if patient else None,
        "acuity": patient.acuity if patient else None,
        "needs_or": patient.needs_or if patient else False,
        "physician": patient.physician if patient else None,
        "nurse": patient.nurse if patient else None,
        "age": patient.age if patient else None,
        "chief_complaint": patient.chief_complaint if patient else None,
        "diagnosis": patient.diagnosis if patient else None,
    }


def _rooms(db: Session):
    rows = db.scalars(select(Room).options(selectinload(Room.patient)).order_by(Room.id)).all()
    return [_room_payload(room) for room in rows]


@router.get("/census")
def census(db: Session = Depends(get_db)):
    state = db.get(HospitalState, 1)
    return {"surge": bool(state and state.surge), "rooms": _rooms(db)}


@router.get("/ors")
def operating_rooms(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Room).options(selectinload(Room.patient)).where(Room.kind == "or").order_by(Room.id)
    ).all()
    return {"rooms": [_room_payload(room) for room in rows]}


@router.get("/transfers")
def transfers(db: Session = Depends(get_db)):
    rows = db.scalars(select(Transfer).order_by(Transfer.id.desc()).limit(20)).all()
    return {
        "transfers": [
            {
                "id": row.id,
                "patient_name": row.patient_name,
                "destination": row.destination,
                "reason": row.reason,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }


@router.get("/flow")
def flow(db: Session = Depends(get_db)):
    rows = db.scalars(select(FlowEvent).order_by(FlowEvent.id.desc()).limit(40)).all()
    return {
        "events": [
            {
                "id": row.id,
                "patient_name": row.patient_name,
                "message": row.message,
                "kind": row.kind,
                "room_id": row.room_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }


@router.post("/surge")
def surge(db: Session = Depends(get_db)):
    flipped = declare_surge(db)
    state = db.get(HospitalState, 1)
    return {"flipped": flipped, "surge": bool(state and state.surge), "rooms": _rooms(db)}
