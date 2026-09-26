from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalog import census_rooms
from app.models import FlowEvent, HospitalState, Patient, Room


def seed_if_empty(db: Session):
    existing = db.scalar(select(func.count()).select_from(Room))
    if existing:
        return
    specs = census_rooms()
    for spec in specs:
        db.add(Room(
            id=spec["id"],
            floor_id=spec["floor_id"],
            kind=spec["kind"],
            dept=spec["dept"],
            status=spec["status"],
            surge=spec["surge"],
        ))
    db.flush()
    for spec in specs:
        if not spec["patient"]:
            continue
        db.add(Patient(
            name=spec["patient"],
            acuity=spec["status"],
            room_id=spec["id"],
            needs_or=spec["needs_or"],
            physician=spec["physician"],
            nurse=spec["nurse"],
        ))
    db.add(HospitalState(id=1, surge=False, admit_index=0, tick_count=0))
    db.add(FlowEvent(
        patient_name="Census",
        message="Floor plate loaded from the live census",
        room_id=None,
    ))
