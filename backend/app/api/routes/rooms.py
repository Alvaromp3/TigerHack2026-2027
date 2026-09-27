from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.infra.audit import get_actor, record
from app.models import Housekeeper, Room
from app.sim import assign_housekeeper, complete_clean, discharge_room, release_room, reserve_room

router = APIRouter()


class ReserveIn(BaseModel):
    hold_for: str = Field(min_length=1, max_length=80)


class AssignIn(BaseModel):
    housekeeper_id: int


def _fail(message: str | None):
    if message:
        raise HTTPException(status_code=409, detail=message)


@router.post("/rooms/{room_id}/reserve")
def reserve(room_id: str, body: ReserveIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _fail(reserve_room(db, room_id, body.hold_for))
    record(db, actor, "bed.hold", room_id, f"Held for {body.hold_for.strip()}")
    return {"room_id": room_id, "status": "reserved", "hold_for": body.hold_for.strip()}


@router.post("/rooms/{room_id}/release")
def release(room_id: str, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _fail(release_room(db, room_id))
    record(db, actor, "bed.release", room_id, "Hold released")
    return {"room_id": room_id, "status": "available"}


@router.post("/rooms/{room_id}/assign")
def assign(room_id: str, body: AssignIn, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _fail(assign_housekeeper(db, room_id, body.housekeeper_id))
    keeper = db.get(Housekeeper, body.housekeeper_id)
    record(db, actor, "evs.assign", room_id, f"Sent {keeper.name if keeper else 'housekeeper'} to clean")
    return {"room_id": room_id, "housekeeper_id": body.housekeeper_id}


@router.post("/rooms/{room_id}/clean/complete")
def complete(room_id: str, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    message, opened = complete_clean(db, room_id)
    if message and not opened:
        if message.startswith("That room"):
            raise HTTPException(status_code=409, detail=message)
        return {"room_id": room_id, "opened": False, "reason": message}
    record(db, actor, "bed.open", room_id, "Bed opened for admission")
    return {"room_id": room_id, "opened": True}


@router.post("/rooms/{room_id}/discharge")
def discharge(room_id: str, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    room = db.get(Room, room_id)
    name = room.patient.name if room is not None and room.patient is not None else None
    _fail(discharge_room(db, room_id))
    record(db, actor, "patient.discharge", room_id, f"Discharged {name}" if name else "Discharged")
    return {"room_id": room_id, "status": "cleaning"}
