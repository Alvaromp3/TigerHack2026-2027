"""One random legal census change every tick, plus the housekeeping queue."""

import logging
import random
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import DESTINATIONS, OCCUPIED, clinical_case, crew, fresh_patient_name
from app.models import Death, FlowEvent, HospitalState, Housekeeper, LinenAide, Patient, Room, Transfer

log = logging.getLogger(__name__)
write_lock = threading.Lock()
TICK_SECONDS = 9
DEATH_CHANCE = 0.08
CLEAN_TICKS = {"stat": 2, "standard": 4, "terminal": 8}
LINEN_STAGE_TICKS = {"pickup": 1, "wash": 2, "deliver": 1}
LINEN_NEXT = {"pickup": "wash", "wash": "deliver"}
LINEN_ACTIVE = ("pickup", "wash", "deliver")
ISOLATION_MARKERS = ("sepsis", "c. diff", "c.diff", "covid", "mrsa", "tb", "tubercul", "isolation")


def tick(db: Session):
    with write_lock:
        state = db.get(HospitalState, 1)
        if state is not None:
            state.tick_count += 1
        cleaned = _advance_cleaning(db)
        delivered = _advance_linen(db)
        action = _roll(db)
        _assign_housekeepers(db)
        _assign_linen(db)
        summary = " · ".join(part for part in (cleaned, delivered, action) if part)
        if summary:
            log.info("census tick: %s", summary)
        db.commit()
        return action or cleaned


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
    return None


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
    _clear_clean(bed)
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
    clinical = _clinical_text(patient)
    db.delete(patient)
    _vacate(db, room, clinical)
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
    clinical = _clinical_text(patient)
    db.add(Death(
        patient_name=name,
        age=patient.age,
        diagnosis=patient.diagnosis,
        room_id=room_id,
    ))
    db.delete(patient)
    _vacate(db, room, clinical)
    _log(db, name, f"{name} died in {room_id}", room_id, "death")
    return f"death {name}"


def ensure_cleaning_queue(db: Session):
    """Queue beds already in cleaning, and put free housekeepers on the front."""
    db.flush()
    keepers = list(db.scalars(select(Housekeeper).order_by(Housekeeper.id)).all())
    for keeper in keepers:
        if not keeper.room_id:
            continue
        room = db.get(Room, keeper.room_id)
        if room is None or room.status != "cleaning":
            keeper.room_id = None
    pending = list(db.scalars(
        select(Room).where(Room.status == "cleaning", Room.ticks_left.is_(None))
    ).all())
    for room in pending:
        _stamp_clean(db, room, "")
    for room in db.scalars(select(Room).where(Room.status == "cleaning", Room.linen_stage.is_(None))).all():
        _start_linen(db, room)
    aides = list(db.scalars(select(LinenAide).order_by(LinenAide.id)).all())
    for aide in aides:
        if not aide.room_id:
            continue
        room = db.get(Room, aide.room_id)
        if room is None or room.status != "cleaning" or room.linen_stage not in LINEN_ACTIVE:
            aide.room_id = None
    _assign_housekeepers(db)
    _assign_linen(db)


def _advance_cleaning(db: Session):
    keepers = list(db.scalars(select(Housekeeper).order_by(Housekeeper.id)).all())
    finished = []
    for keeper in keepers:
        if not keeper.room_id:
            continue
        room = db.get(Room, keeper.room_id)
        if room is None or room.status != "cleaning":
            keeper.room_id = None
            continue
        room.ticks_left = (room.ticks_left or 1) - 1
        if room.ticks_left <= 0:
            opened = _finish_clean(db, room, keeper)
            if opened:
                finished.append(opened)
    if not finished:
        return None
    return ", ".join(finished)


def _finish_clean(db: Session, room: Room, keeper: Housekeeper):
    keeper.room_id = None
    room.ticks_left = 0
    return _try_open(db, room, keeper.name)


def _advance_linen(db: Session):
    aides = list(db.scalars(select(LinenAide).order_by(LinenAide.id)).all())
    delivered = []
    for aide in aides:
        if not aide.room_id:
            continue
        room = db.get(Room, aide.room_id)
        if room is None or room.status != "cleaning" or room.linen_stage not in LINEN_ACTIVE:
            aide.room_id = None
            continue
        room.linen_ticks = (room.linen_ticks or 1) - 1
        if room.linen_ticks > 0:
            continue
        nxt = LINEN_NEXT.get(room.linen_stage)
        if nxt:
            room.linen_stage = nxt
            room.linen_ticks = LINEN_STAGE_TICKS[nxt]
            continue
        room.linen_stage = "ready"
        room.linen_ticks = 0
        aide.room_id = None
        _log(db, "Linen", f"{room.id} clean linen delivered", room.id, "clean")
        opened = _try_open(db, room, aide.name)
        delivered.append(opened or f"linen {room.id}")
    if not delivered:
        return None
    return ", ".join(delivered)


def _assign_linen(db: Session):
    db.flush()
    aides = list(db.scalars(select(LinenAide).order_by(LinenAide.id)).all())
    busy = {aide.room_id for aide in aides if aide.room_id}
    waiting = []
    for room in db.scalars(select(Room).where(Room.status == "cleaning")).all():
        if room.linen_stage not in LINEN_ACTIVE or room.id in busy:
            continue
        waiting.append(room)
    waiting.sort(key=lambda room: (-(room.clean_priority or 0), room.queued_tick or 0, room.id))
    free = [aide for aide in aides if not aide.room_id]
    for aide, room in zip(free, waiting):
        aide.room_id = room.id


def _try_open(db: Session, room: Room, keeper_name: str | None = None):
    if room.status != "cleaning" or (room.ticks_left or 0) > 0 or room.linen_stage != "ready":
        return None
    clean_type = room.clean_type or "standard"
    who = keeper_name or "Housekeeping"
    _release_linen(db, room)
    room.status = "available"
    _clear_clean(room)
    _log(db, "Housekeeping", f"{room.id} is open · {who} · {clean_type}", room.id, "clean")
    return f"clean {room.id}"


def _release_linen(db: Session, room: Room):
    for aide in db.scalars(select(LinenAide).where(LinenAide.room_id == room.id)).all():
        aide.room_id = None


def _start_linen(db: Session, room: Room):
    state = db.get(HospitalState, 1)
    room.linen_stage = "pickup"
    room.linen_ticks = LINEN_STAGE_TICKS["pickup"]
    if room.queued_tick is None:
        room.queued_tick = state.tick_count if state is not None else 0


def _assign_housekeepers(db: Session):
    db.flush()
    keepers = list(db.scalars(select(Housekeeper).order_by(Housekeeper.id)).all())
    busy = {keeper.room_id for keeper in keepers if keeper.room_id}
    waiting = []
    for room in db.scalars(select(Room).where(Room.status == "cleaning")).all():
        if room.id in busy or (room.ticks_left or 0) <= 0:
            continue
        room.clean_priority = 1 if _in_demand(db, room) else 0
        waiting.append(room)
    waiting.sort(key=lambda room: (-(room.clean_priority or 0), room.queued_tick or 0, room.id))
    free = [keeper for keeper in keepers if not keeper.room_id]
    for keeper, room in zip(free, waiting):
        keeper.room_id = room.id


def _vacate(db: Session, room: Room, clinical_text: str):
    room.status = "cleaning"
    db.flush()
    _stamp_clean(db, room, clinical_text)


def _stamp_clean(db: Session, room: Room, clinical_text: str):
    state = db.get(HospitalState, 1)
    isolation = _is_isolation(clinical_text)
    demand = _in_demand(db, room)
    if isolation:
        clean_type = "terminal"
    elif demand:
        clean_type = "stat"
    else:
        clean_type = "standard"
    room.clean_type = clean_type
    room.clean_priority = 1 if demand else 0
    room.ticks_left = CLEAN_TICKS[clean_type]
    room.queued_tick = state.tick_count if state is not None else 0
    _start_linen(db, room)


def _is_isolation(clinical_text: str) -> bool:
    text = (clinical_text or "").lower()
    return any(marker in text for marker in ISOLATION_MARKERS)


def _clinical_text(patient: Patient) -> str:
    return f"{patient.diagnosis or ''} {patient.chief_complaint or ''}"


def _in_demand(db: Session, room: Room) -> bool:
    return not _class_beds(db, room)


def _class_beds(db: Session, room: Room):
    if room.kind == "or":
        return _beds(db, kind="or")
    if room.floor_id == "F1" and room.id.startswith("ED"):
        return _beds(db, floor_id="F1", prefix="ED")
    if room.floor_id == "F1" and room.id.startswith("FAST"):
        return _beds(db, floor_id="F1", prefix="FAST")
    if room.floor_id == "F1" and room.id.startswith("OBS"):
        return _beds(db, floor_id="F1", prefix="OBS")
    if room.floor_id == "F3" and room.id.startswith("ER"):
        return _beds(db, floor_id="F3", prefix="ER")
    if room.dept == "icu":
        return _beds(db, floor_id=room.floor_id, dept="icu")
    if room.floor_id == "F3" and room.id.startswith("MS"):
        return _beds(db, floor_id="F3", dept="med", prefix="MS")
    if room.floor_id == "F2" and room.dept == "med":
        return _beds(db, floor_id="F2", dept="med")
    if room.dept == "surgward":
        return _beds(db, floor_id=room.floor_id, dept="surgward")
    return _beds(db, floor_id=room.floor_id, dept=room.dept, kind=room.kind or "bed")


def _clear_clean(room: Room):
    room.clean_type = None
    room.clean_priority = None
    room.ticks_left = None
    room.queued_tick = None
    room.linen_stage = None
    room.linen_ticks = None


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
    clinical = _clinical_text(patient)
    origin.status = "cleaning"
    patient.room = dest
    team = _team_for(dest)
    patient.physician, patient.nurse = crew(team, random.randrange(2))
    if dest.kind == "or":
        dest.status = "warning"
    else:
        dest.status = patient.acuity if patient.acuity in OCCUPIED else "normal"
    _clear_clean(dest)
    db.flush()
    _stamp_clean(db, origin, clinical)
    _log(db, patient.name, message, dest.id, "move")
    return message


def _transfer(db: Session, patient: Patient, reason: str):
    destination = DESTINATIONS[reason]
    name = patient.name
    room = patient.room
    clinical = _clinical_text(patient)
    db.delete(patient)
    db.add(Transfer(patient_name=name, destination=destination, reason=reason))
    _vacate(db, room, clinical)
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
