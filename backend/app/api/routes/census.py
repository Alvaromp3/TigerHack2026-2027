from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import FlowEvent, HospitalState, Housekeeper, LinenAide, Room, Staff, Transfer
from app.sim import declare_surge

router = APIRouter()


def _room_payload(room: Room, housekeeper: str | None = None, linen_aide: str | None = None):
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
        "clean_type": room.clean_type,
        "clean_priority": room.clean_priority,
        "ticks_left": room.ticks_left,
        "queued_tick": room.queued_tick,
        "housekeeper": housekeeper,
        "linen_stage": room.linen_stage,
        "linen_ticks": room.linen_ticks,
        "linen_aide": linen_aide,
    }


def _keeper_names(db: Session):
    rows = db.scalars(select(Housekeeper).order_by(Housekeeper.id)).all()
    return rows, {row.room_id: row.name for row in rows if row.room_id}


def _aide_names(db: Session):
    rows = db.scalars(select(LinenAide).order_by(LinenAide.id)).all()
    return rows, {row.room_id: row.name for row in rows if row.room_id}


def _rooms(db: Session):
    rows = db.scalars(select(Room).options(selectinload(Room.patient)).order_by(Room.id)).all()
    _, by_keeper = _keeper_names(db)
    _, by_aide = _aide_names(db)
    return [_room_payload(room, by_keeper.get(room.id), by_aide.get(room.id)) for room in rows]


@router.get("/census")
def census(db: Session = Depends(get_db)):
    state = db.get(HospitalState, 1)
    keepers, _ = _keeper_names(db)
    aides, _ = _aide_names(db)
    return {
        "surge": bool(state and state.surge),
        "rooms": _rooms(db),
        "housekeepers": [
            {"id": keeper.id, "name": keeper.name, "room_id": keeper.room_id}
            for keeper in keepers
        ],
        "linen_aides": [
            {"id": aide.id, "name": aide.name, "room_id": aide.room_id}
            for aide in aides
        ],
    }


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


def _flow_payload(row: FlowEvent):
    return {
        "id": row.id,
        "patient_name": row.patient_name,
        "message": row.message,
        "kind": row.kind,
        "room_id": row.room_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/flow")
def flow(q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(FlowEvent).order_by(FlowEvent.id.desc())
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        stmt = stmt.where(or_(
            FlowEvent.patient_name.ilike(like),
            FlowEvent.message.ilike(like),
            FlowEvent.room_id.ilike(like),
            FlowEvent.kind.ilike(like),
        )).limit(100)
    else:
        stmt = stmt.limit(200)
    rows = db.scalars(stmt).all()
    return {"events": [_flow_payload(row) for row in rows]}


@router.get("/staff")
def staff(db: Session = Depends(get_db)):
    rows = db.scalars(select(Staff).order_by(Staff.unit, Staff.role, Staff.name)).all()
    return {
        "staff": [
            {
                "id": row.id,
                "name": row.name,
                "role": row.role,
                "unit": row.unit,
                "specialty": row.specialty,
                "shift": row.shift,
                "on_duty": row.on_duty,
                "extension": row.extension,
            }
            for row in rows
        ]
    }


@router.post("/surge")
def surge(db: Session = Depends(get_db)):
    flipped = declare_surge(db)
    state = db.get(HospitalState, 1)
    return {"flipped": flipped, "surge": bool(state and state.surge), "rooms": _rooms(db)}
