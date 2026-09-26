"""One random legal census change every tick."""

import logging
import random
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import DESTINATIONS, OCCUPIED, clinical_case, crew, fresh_patient_name
from app.models import Death, FlowEvent, HospitalState, Patient, Room, Transfer

log = logging.getLogger(__name__)
write_lock = threading.Lock()
TICK_SECONDS = 9
DEATH_CHANCE = 0.08


def tick(db: Session):
    with write_lock:
        state = db.get(HospitalState, 1)
        if state is not None:
            state.tick_count += 1
        action = _roll(db)
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
            select(Room).where(
                Room.floor_id.in_(("F1", "F3")),
                Room.surge.is_(True),
                Room.kind == "bed",
                Room.status == "available",
            )
        ).all()
        flipped = 0
        taken = set(db.scalars(select(Patient.name)).all())
        for room in rooms:
            flipped += 1
            team = "icu" if room.dept == "icu" else "ed"
            physician, nurse = crew(team, random.randrange(2))
            name = fresh_patient_name(taken, random.randrange(10_000))
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
            _log(db, name, f"{name} admitted to {room.id}", room.id, "admit")
        _log(db, "Command", f"Surge declared. {flipped} open beds held on F1 and F3.", None, "admit")
        db.commit()
        return flipped


def _roll(db: Session):
    critical = _people(db, acuity="critical")
    if critical and random.random() < DEATH_CHANCE:
        return _die(db, random.choice(critical))

    options = []

    def offer(possible, step):
        if possible:
            options.append(step)

    offer(bool(_beds(db, floor_id="F1", prefix="ED")), lambda: _admit(db, "F1", "ED"))
    offer(bool(_beds(db, floor_id="F1", prefix="FAST")), lambda: _admit(db, "F1", "FAST"))
    offer(bool(_beds(db, floor_id="F1", prefix="OBS")), lambda: _admit(db, "F1", "OBS"))
    offer(bool(_beds(db, floor_id="F3", prefix="ER")), lambda: _admit(db, "F3", "ER"))
    offer(
        bool(_people(db, floor_id="F1", acuity="critical")) and bool(_beds(db, floor_id="F3", dept="icu")),
        lambda: _shift(db, people=_people(db, floor_id="F1", acuity="critical"), beds=_beds(db, floor_id="F3", dept="icu"), label="ICU"),
    )
    offer(
        bool(_people(db, floor_id="F1", stable=True)) and bool(_beds(db, floor_id="F2", dept="med")),
        lambda: _shift(db, people=_people(db, floor_id="F1", stable=True), beds=_beds(db, floor_id="F2", dept="med"), label="medicine"),
    )
    offer(
        bool(_people(db, floor_id="F1", stable=True)) and bool(_beds(db, floor_id="F3", dept="med", prefix="MS")),
        lambda: _shift(db, people=_people(db, floor_id="F1", stable=True), beds=_beds(db, floor_id="F3", dept="med", prefix="MS"), label="medicine"),
    )
    offer(
        bool(_people(db, floor_id="F2", needs_or=True)) and bool(_beds(db, kind="or")),
        lambda: _shift(db, people=_people(db, floor_id="F2", needs_or=True), beds=_beds(db, kind="or"), label="OR"),
    )
    offer(
        bool(_people(db, kind="or")) and bool(_beds(db, floor_id="F4", dept="surgward")),
        _leave_or,
    )
    offer(
        bool(_people(db, floor_id="F3", dept="icu", stable=True)) and bool(_beds(db, floor_id="F2", dept="med")),
        lambda: _shift(db, people=_people(db, floor_id="F3", dept="icu", stable=True), beds=_beds(db, floor_id="F2", dept="med"), label="medicine"),
    )
    offer(
        bool(_people(db, floor_id="F3", dept="icu", stable=True)) and bool(_beds(db, floor_id="F3", dept="med", prefix="MS")),
        lambda: _shift(db, people=_people(db, floor_id="F3", dept="icu", stable=True), beds=_beds(db, floor_id="F3", dept="med", prefix="MS"), label="medicine"),
    )
    offer(
        bool(_people(db, floor_id="F4", dept="surgward", stable=True, needs_or=False)) and bool(_beds(db, floor_id="F2", dept="med")),
        lambda: _shift(db, people=_people(db, floor_id="F4", dept="surgward", stable=True, needs_or=False), beds=_beds(db, floor_id="F2", dept="med"), label="medicine"),
    )
    offer(bool(_discharge_pool(db, floor_id="F2", dept="med")), lambda: _discharge(db, floor_id="F2", dept="med"))
    offer(bool(_discharge_pool(db, floor_id="F3", dept="med")), lambda: _discharge(db, floor_id="F3", dept="med"))
    offer(bool(_discharge_pool(db, floor_id="F4", dept="surgward")), lambda: _discharge(db, floor_id="F4", dept="surgward"))
    offer(bool(_discharge_pool(db, floor_id="F1", prefix="OBS")), lambda: _discharge(db, floor_id="F1", prefix="OBS"))
    offer(
        bool(_people(db, floor_id="F1", acuity="critical")) and not _beds(db, floor_id="F3", dept="icu"),
        lambda: _divert(db, floor_id="F1", acuity="critical", open_floor="F3", open_dept="icu", reason="icu_full"),
    )
    offer(
        bool(_people(db, floor_id="F2", needs_or=True)) and not _beds(db, kind="or"),
        lambda: _divert_or(db),
    )
    if options:
        chosen = random.choice(options)
        return chosen(db) if chosen is _leave_or else chosen()
    return _clean_one(db)


def _admit(db: Session, floor_id: str, prefix: str):
    beds = _beds(db, floor_id=floor_id, prefix=prefix)
    state = db.get(HospitalState, 1)
    if not beds or state is None:
        return None
    state.admit_index += 1
    bed = random.choice(beds)
    acuity = random.choice(("critical", "warning", "normal"))
    taken = set(db.scalars(select(Patient.name)).all())
    name = fresh_patient_name(taken, random.randrange(10_000))
    physician, nurse = crew("ed", random.randrange(2))
    case = clinical_case(name, acuity, state.admit_index)
    patient = Patient(
        name=name,
        acuity=acuity,
        room_id=bed.id,
        needs_or=random.random() < 0.35,
        physician=physician,
        nurse=nurse,
        age=case["age"],
        chief_complaint=case["chief_complaint"],
        diagnosis=case["diagnosis"],
    )
    db.add(patient)
    bed.status = acuity
    _log(db, name, f"{name} admitted to {bed.id}", bed.id, "admit")
    return f"admit {name}"


def _shift(db: Session, people, beds, label: str):
    if not people or not beds:
        return None
    patient = random.choice(people)
    dest = random.choice(beds)
    if label == "OR":
        message = f"{patient.name} in {dest.id}"
    else:
        message = f"{patient.name} moved to {label} {dest.id}"
    if dest.dept == "surgward" and patient.room.kind == "or":
        patient.needs_or = False
        patient.acuity = "normal"
        message = f"{patient.name} left the OR for {dest.id}"
    return _move(db, patient, dest, message)


def _leave_or(db: Session):
    people = _people(db, kind="or")
    beds = _beds(db, floor_id="F4", dept="surgward")
    if not people or not beds:
        return None
    patient = random.choice(people)
    dest = random.choice(beds)
    patient.needs_or = False
    patient.acuity = "normal"
    return _move(db, patient, dest, f"{patient.name} left the OR for {dest.id}")


def _discharge_pool(db: Session, floor_id: str, dept=None, prefix=None):
    if prefix == "OBS":
        return _people(db, floor_id=floor_id, prefix=prefix, stable=True, needs_or=False)
    return _people(db, floor_id=floor_id, dept=dept, acuity="normal", needs_or=False)


def _discharge(db: Session, floor_id: str, dept=None, prefix=None):
    people = _discharge_pool(db, floor_id, dept, prefix)
    if not people:
        return None
    patient = random.choice(people)
    room = patient.room
    name = patient.name
    room_id = room.id
    db.delete(patient)
    room.status = "cleaning"
    _log(db, name, f"{name} discharged from {room_id}", room_id, "discharge")
    return f"discharge {name}"


def _divert(db: Session, floor_id: str, acuity: str, open_floor: str, open_dept: str, reason: str):
    if _beds(db, floor_id=open_floor, dept=open_dept):
        return None
    people = _people(db, floor_id=floor_id, acuity=acuity)
    if not people:
        return None
    return _transfer(db, random.choice(people), reason)


def _divert_or(db: Session):
    if _beds(db, kind="or"):
        return None
    people = _people(db, floor_id="F2", needs_or=True)
    if not people:
        return None
    return _transfer(db, random.choice(people), "or_full")


def _die(db: Session, patient: Patient):
    room = patient.room
    name = patient.name
    room_id = room.id
    db.add(Death(
        patient_name=name,
        age=patient.age,
        diagnosis=patient.diagnosis,
        room_id=room_id,
    ))
    db.delete(patient)
    room.status = "cleaning"
    _log(db, name, f"{name} died in {room_id}", room_id, "death")
    return f"death {name}"


def _clean_one(db: Session):
    rooms = list(db.scalars(select(Room).where(Room.status == "cleaning")).all())
    if not rooms:
        return None
    room = random.choice(rooms)
    room.status = "available"
    _log(db, "Housekeeping", f"{room.id} is open", room.id, "clean")
    return f"clean {room.id}"


def _people(db: Session, floor_id=None, dept=None, prefix=None, acuity=None, stable=False, needs_or=None, kind="bed"):
    stmt = select(Patient).join(Room)
    if kind:
        stmt = stmt.where(Room.kind == kind)
    if floor_id:
        stmt = stmt.where(Room.floor_id == floor_id)
    if dept:
        stmt = stmt.where(Room.dept == dept)
    if acuity:
        stmt = stmt.where(Patient.acuity == acuity)
    if stable:
        stmt = stmt.where(Patient.acuity.in_(("normal", "warning")))
    if needs_or is not None:
        stmt = stmt.where(Patient.needs_or.is_(needs_or))
    rows = list(db.scalars(stmt).unique().all())
    if prefix:
        rows = [person for person in rows if person.room and person.room.id.startswith(prefix)]
    return rows


def _beds(db: Session, floor_id=None, dept=None, prefix=None, kind="bed"):
    stmt = select(Room).where(
        Room.kind == kind,
        Room.status == "available",
        ~Room.id.in_(select(Patient.room_id)),
    )
    if floor_id:
        stmt = stmt.where(Room.floor_id == floor_id)
    if dept:
        stmt = stmt.where(Room.dept == dept)
    rows = list(db.scalars(stmt).all())
    if prefix:
        rows = [room for room in rows if room.id.startswith(prefix)]
    return rows


def _move(db: Session, patient: Patient, dest: Room, message: str):
    origin = patient.room
    origin.status = "cleaning"
    patient.room = dest
    team = _team_for(dest)
    patient.physician, patient.nurse = crew(team, random.randrange(2))
    if dest.kind == "or":
        dest.status = "warning"
    else:
        dest.status = patient.acuity if patient.acuity in OCCUPIED else "normal"
    _log(db, patient.name, message, dest.id, "move")
    return message


def _transfer(db: Session, patient: Patient, reason: str):
    destination = DESTINATIONS[reason]
    name = patient.name
    room = patient.room
    room.status = "cleaning"
    db.delete(patient)
    db.add(Transfer(patient_name=name, destination=destination, reason=reason))
    label = "ICU full" if reason == "icu_full" else "both ORs busy"
    _log(db, name, f"{name} sent to {destination} — {label}", room.id, "transfer")
    return f"transfer {name} {reason}"


def _team_for(room: Room):
    if room.dept == "icu":
        return "icu"
    if room.dept == "ed":
        return "ed"
    if room.kind == "or" or room.dept == "surgward":
        return "surg"
    return "med"


def _log(db: Session, name: str, message: str, room_id: str | None, kind: str):
    db.add(FlowEvent(patient_name=name, message=message, room_id=room_id, kind=kind))
