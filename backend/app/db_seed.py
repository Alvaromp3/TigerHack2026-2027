from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalog import census_rooms
from app.models import FlowEvent, HospitalState, Patient, Room
from app.sim import vital_set


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
            age=spec.get("age"),
            chief_complaint=spec.get("chief_complaint"),
            diagnosis=spec.get("diagnosis"),
            stay_ticks=3,
            **vital_set(spec["status"], len(spec["id"]) + len(spec["patient"] or "")),
        ))
    db.add(HospitalState(id=1, surge=False, admit_index=0, tick_count=0))
    db.add(FlowEvent(
        patient_name="Census",
        message="Floor plate loaded from the live census",
        kind="admit",
        room_id=None,
    ))
