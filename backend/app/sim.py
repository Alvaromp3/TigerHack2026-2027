"""One census change every tick: admit, move, operate, discharge, or divert."""

import logging
import threading

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalog import DESTINATIONS, OCCUPIED, clinical_case, crew, fresh_patient_name
from app.models import FlowEvent, HospitalState, Patient, Room, Transfer

log = logging.getLogger(__name__)
write_lock = threading.Lock()
TICK_SECONDS = 9
KEEP_EVENTS = 40
KEEP_TRANSFERS = 20


def tick(db: Session):
    with write_lock:
        state = db.get(HospitalState, 1)
        steps = [
            _move_critical_to_icu,
            _divert_icu_full,
            _move_stable_to_medicine,
            _move_to_or,
            _divert_or_full,
            _finish_or,
            _discharge,
            _admit,
        ]
        phase = 0 if state is None else state.tick_count % len(steps)
        if state is not None:
            state.tick_count += 1
        action = steps[phase](db)
        if not action:
            for step in steps:
                if step in (_divert_icu_full, _divert_or_full):
                    continue
                action = step(db)
                if action:
                    break
        if not action:
            action = _clean_one(db)
        if action:
            log.info("census tick: %s", action)
        db.commit()
        return action


def declare_surge(db: Session) -> int:
    with write_lock:
        state = db.get(HospitalState, 1)
        if state is None or state.surge:
            return 0
        state.surge = True
        rooms = db.scalars(
            select(Room)
            .where(
                Room.floor_id.in_(("F1", "F3")),
                Room.surge.is_(True),
                Room.kind == "bed",
                Room.status == "available",
            )
            .order_by(Room.id)
        ).all()
        flipped = 0
        taken = set(db.scalars(select(Patient.name)).all())
        for room in rooms:
            flipped += 1
            team = "icu" if room.dept == "icu" else "ed"
            physician, nurse = crew(team, 0)
            name = fresh_patient_name(taken, flipped)
            taken.add(name)
            case = clinical_case(name, "critical", flipped)
            db.add(Patient(
                name=name,
                acuity="critical",
                room_id=room.id,
                needs_or=False,
                physician=physician,
                nurse=nurse,
                age=case["age"],
                chief_complaint=case["chief_complaint"],
                diagnosis=case["diagnosis"],
            ))
            room.status = "critical"
        _log(db, "Command", f"Surge declared. {flipped} open beds held on F1 and F3.", None)
        db.commit()
        return flipped


def _move_critical_to_icu(db: Session):
    patient = _waiting(db, floor_id="F1", acuity="critical")
    bed = _open_bed(db, floor_id="F3", dept="icu")
    if not patient or not bed:
        return None
    return _move(db, patient, bed, f"{patient.name} moved to ICU {bed.id}")


def _divert_icu_full(db: Session):
    patient = _waiting(db, floor_id="F1", acuity="critical")
    if not patient or _open_bed(db, floor_id="F3", dept="icu"):
        return None
    return _transfer(db, patient, "icu_full")


def _move_to_or(db: Session):
    patient = _waiting(db, floor_id="F2", needs_or=True)
    theatre = _open_or(db)
    if not patient or not theatre:
        return None
    return _move(db, patient, theatre, f"{patient.name} in {theatre.id}")


def _divert_or_full(db: Session):
    patient = _waiting(db, floor_id="F2", needs_or=True)
    if not patient or _open_or(db):
        return None
    return _transfer(db, patient, "or_full")


def _move_stable_to_medicine(db: Session):
    patient = _waiting(db, floor_id="F1", stable=True)
    bed = _open_bed(db, floor_id="F2", dept="med")
    if not patient or not bed:
        return None
    return _move(db, patient, bed, f"{patient.name} moved to medicine {bed.id}")


def _discharge(db: Session):
    patient = db.scalars(
        select(Patient)
        .join(Room)
        .where(
            Room.floor_id.in_(("F2", "F4")),
            Patient.acuity == "normal",
            Patient.needs_or.is_(False),
        )
        .order_by(Patient.id)
        .limit(1)
    ).first()
    if not patient:
        return None
    room = patient.room
    name = patient.name
    room_id = room.id
    db.delete(patient)
    room.status = "cleaning"
    _log(db, name, f"{name} discharged from {room_id}", room_id)
    return f"discharge {name}"


def _finish_or(db: Session):
    patient = db.scalars(
        select(Patient).join(Room).where(Room.kind == "or").order_by(Patient.id).limit(1)
    ).first()
    bed = _open_bed(db, floor_id="F4", dept="surgward")
    if not patient or not bed:
        return None
    patient.needs_or = False
    patient.acuity = "normal"
    return _move(db, patient, bed, f"{patient.name} left the OR for {bed.id}")


def _admit(db: Session):
    bed = _open_bed(db, floor_id="F1")
    state = db.get(HospitalState, 1)
    if not bed or state is None:
        return None
    index = state.admit_index
    state.admit_index = index + 1
    acuity = ("critical", "normal", "warning", "normal")[index % 4]
    name = _fresh_name(db, index)
    physician, nurse = crew("ed", index)
    case = clinical_case(name, acuity, index)
    patient = Patient(
        name=name,
        acuity=acuity,
        room_id=bed.id,
        needs_or=acuity != "critical" and index % 3 == 0,
        physician=physician,
        nurse=nurse,
        age=case["age"],
        chief_complaint=case["chief_complaint"],
        diagnosis=case["diagnosis"],
    )
    db.add(patient)
    bed.status = acuity
    _log(db, name, f"{name} admitted to {bed.id}", bed.id)
    return f"admit {name}"


def _clean_one(db: Session):
    room = db.scalars(
        select(Room).where(Room.status == "cleaning").order_by(Room.id).limit(1)
    ).first()
    if not room:
        return None
    room.status = "available"
    _log(db, "Housekeeping", f"{room.id} is open", room.id)
    return f"clean {room.id}"


def _waiting(db: Session, floor_id, acuity=None, needs_or=None, stable=False):
    stmt = select(Patient).join(Room).where(Room.floor_id == floor_id, Room.kind == "bed")
    if acuity:
        stmt = stmt.where(Patient.acuity == acuity)
    if stable:
        stmt = stmt.where(Patient.acuity.in_(("normal", "warning")))
    if needs_or is not None:
        stmt = stmt.where(Patient.needs_or.is_(needs_or))
    return db.scalars(stmt.order_by(Patient.id).limit(1)).first()


def _open_bed(db: Session, floor_id, dept=None):
    stmt = select(Room).where(
        Room.kind == "bed",
        Room.floor_id == floor_id,
        Room.status == "available",
        ~Room.id.in_(select(Patient.room_id)),
    )
    if dept:
        stmt = stmt.where(Room.dept == dept)
    return db.scalars(stmt.order_by(Room.id).limit(1)).first()


def _open_or(db: Session):
    return db.scalars(
        select(Room)
        .where(
            Room.kind == "or",
            Room.status == "available",
            ~Room.id.in_(select(Patient.room_id)),
        )
        .order_by(Room.id)
        .limit(1)
    ).first()


def _move(db: Session, patient: Patient, dest: Room, message: str):
    origin = patient.room
    origin.status = "cleaning"
    patient.room = dest
    team = _team_for(dest)
    patient.physician, patient.nurse = crew(team, 0)
    if dest.kind == "or":
        dest.status = "warning"
    else:
        dest.status = patient.acuity if patient.acuity in OCCUPIED else "normal"
    _log(db, patient.name, message, dest.id)
    return message


def _transfer(db: Session, patient: Patient, reason: str):
    destination = DESTINATIONS[reason]
    name = patient.name
    room = patient.room
    room.status = "cleaning"
    db.delete(patient)
    db.add(Transfer(patient_name=name, destination=destination, reason=reason))
    db.flush()
    _trim(db, Transfer, KEEP_TRANSFERS)
    label = "ICU full" if reason == "icu_full" else "both ORs busy"
    _log(db, name, f"{name} sent to {destination} — {label}", room.id)
    return f"transfer {name} {reason}"


def _team_for(room: Room):
    if room.dept == "icu":
        return "icu"
    if room.dept == "ed":
        return "ed"
    if room.kind == "or" or room.dept == "surgward":
        return "surg"
    return "med"


def _fresh_name(db: Session, index: int):
    taken = set(db.scalars(select(Patient.name)).all())
    return fresh_patient_name(taken, index)


def _log(db: Session, name: str, message: str, room_id: str | None):
    db.add(FlowEvent(patient_name=name, message=message, room_id=room_id))
    db.flush()
    _trim(db, FlowEvent, KEEP_EVENTS)


def _trim(db: Session, model, keep: int):
    total = db.scalar(select(func.count()).select_from(model)) or 0
    extra = total - keep
    if extra <= 0:
        return
    old_ids = db.scalars(select(model.id).order_by(model.id).limit(extra)).all()
    if old_ids:
        db.query(model).filter(model.id.in_(old_ids)).delete(synchronize_session=False)

