"""One weighted clinical movement every tick, plus the housekeeping queue."""

import logging
import random
import threading
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import DESTINATIONS, OCCUPIED, clinical_case, crew, fresh_patient_name
from app.models import (
    Death,
    FlowEvent,
    HospitalState,
    Housekeeper,
    Incident,
    LinenAide,
    Patient,
    Room,
    Transfer,
)

log = logging.getLogger(__name__)
write_lock = threading.Lock()
TICK_SECONDS = 9
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
        _advance_stay(db)
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
                stay_ticks=0,
            ))
            room.status = "critical"
            _log(db, name, f"{name} admitted to {room.id}", room.id, "admit")
        _log(db, "Command", f"Surge declared. {flipped} open beds held on F1 and F3.", None, "admit")
        db.commit()
        return flipped


ADMIT_SITES = (("F1", "ED"), ("F1", "FAST"), ("F1", "OBS"), ("F3", "ER"))
WEIGHTS = {"admit": 30, "transfer": 25, "or": 15, "discharge": 25, "divert": 10, "death": 8}


def _advance_stay(db: Session):
    for patient in db.scalars(select(Patient)).all():
        patient.stay_ticks = (patient.stay_ticks or 0) + 1
        if patient.acuity != "warning" or patient.stay_ticks < 2:
            continue
        patient.acuity = "normal"
        room = patient.room
        if room is not None and room.status == "warning":
            room.status = "normal"
    db.flush()


def _roll(db: Session):
    options = []

    def offer(weight, ready, step):
        if ready:
            options.append((weight, step))

    offer(WEIGHTS["admit"], _admit_sites(db), _admit_one)
    offer(WEIGHTS["transfer"], _transfer_moves(db), _transfer_one)
    offer(WEIGHTS["or"], _or_moves(db), _or_one)
    offer(WEIGHTS["discharge"], _discharge_people(db), _discharge_one)
    offer(WEIGHTS["divert"], _divert_moves(db), _divert_one)
    offer(WEIGHTS["death"], _death_people(db), _death_one)
    for step in _weighted_order(options):
        result = step(db)
        if result:
            return result
    return None


def _weighted_order(options):
    pool = list(options)
    order = []
    while pool:
        total = sum(weight for weight, _step in pool)
        pick = random.uniform(0, total)
        upto = 0
        chosen = 0
        for index, (weight, _step) in enumerate(pool):
            upto += weight
            if pick <= upto:
                chosen = index
                break
        order.append(pool.pop(chosen)[1])
    return order


def _admit_sites(db: Session):
    return [
        (floor_id, prefix)
        for floor_id, prefix in ADMIT_SITES
        if _beds(db, floor_id=floor_id, prefix=prefix)
    ]


def _admit_one(db: Session):
    sites = _admit_sites(db)
    if not sites:
        return None
    floor_id, prefix = random.choice(sites)
    return _admit(db, floor_id, prefix)


def _med_beds(db: Session):
    return _beds(db, floor_id="F2", dept="med") + _beds(db, floor_id="F3", dept="med", prefix="MS")


def _boarding_critical(db: Session):
    people = [
        person for person in _people(db, floor_id="F1", acuity="critical", min_stay=1)
        if person.room and person.room.id.startswith(("ED", "FAST", "OBS"))
    ]
    people.extend(_people(db, floor_id="F3", prefix="ER", acuity="critical", min_stay=1))
    return people


def _boarding_stable(db: Session):
    return [
        person for person in _people(db, floor_id="F1", stable=True, min_stay=1)
        if person.room and person.room.id.startswith(("ED", "FAST"))
    ]


def _transfer_moves(db: Session):
    moves = []
    if _beds(db, floor_id="F3", dept="icu"):
        moves.extend(("icu", person) for person in _boarding_critical(db))
    if _med_beds(db):
        moves.extend(("floor", person) for person in _boarding_stable(db))
        for person in _people(db, floor_id="F3", dept="icu", min_stay=1):
            stayed = person.stay_ticks or 0
            if person.acuity in ("normal", "warning"):
                moves.append(("stepdown", person))
            elif person.acuity == "critical" and stayed >= 4:
                moves.append(("stepdown", person))
    return moves


def _transfer_one(db: Session):
    moves = _transfer_moves(db)
    if not moves:
        return None
    kind, person = random.choice(moves)
    if kind == "icu":
        beds = _beds(db, floor_id="F3", dept="icu")
        if not beds:
            return None
        return _shift(db, people=[person], beds=beds, label="ICU")
    beds = _med_beds(db)
    if not beds:
        return None
    if kind == "stepdown" and person.acuity == "critical":
        person.acuity = "normal"
    return _shift(db, people=[person], beds=beds, label="medicine")


def _surgical_waiting(db: Session):
    waiting = list(_people(db, floor_id="F2", dept="med", needs_or=True, min_stay=1))
    waiting.extend(_people(db, floor_id="F3", dept="med", prefix="MS", needs_or=True, min_stay=1))
    return waiting


def _or_moves(db: Session):
    moves = []
    if _beds(db, kind="or"):
        moves.extend(("in", person) for person in _surgical_waiting(db))
    if _beds(db, floor_id="F4", dept="surgward"):
        moves.extend(("out", person) for person in _people(db, kind="or", min_stay=1))
    return moves


def _or_one(db: Session):
    moves = _or_moves(db)
    if not moves:
        return None
    kind, person = random.choice(moves)
    if kind == "in":
        beds = _beds(db, kind="or")
        if not beds:
            return None
        return _shift(db, people=[person], beds=beds, label="OR")
    beds = _beds(db, floor_id="F4", dept="surgward")
    if not beds:
        return None
    person.needs_or = False
    person.acuity = "normal"
    dest = random.choice(beds)
    return _move(db, person, dest, f"{person.name} left the OR for {dest.id}")


def _discharge_people(db: Session):
    people = list(_people(db, floor_id="F2", dept="med", acuity="normal", needs_or=False, min_stay=3))
    people.extend(_people(db, floor_id="F3", dept="med", prefix="MS", acuity="normal", needs_or=False, min_stay=3))
    people.extend(_people(db, floor_id="F4", dept="surgward", acuity="normal", needs_or=False, min_stay=3))
    people.extend(_people(db, floor_id="F1", prefix="OBS", acuity="normal", needs_or=False, min_stay=3))
    return people


def _discharge_one(db: Session):
    people = _discharge_people(db)
    if not people:
        return None
    return _discharge_patient(db, random.choice(people))


def _divert_moves(db: Session):
    moves = []
    if not _beds(db, floor_id="F3", dept="icu"):
        moves.extend((person, "icu_full") for person in _boarding_critical(db))
    if not _beds(db, kind="or"):
        moves.extend((person, "or_full") for person in _surgical_waiting(db))
    return moves


def _divert_one(db: Session):
    moves = _divert_moves(db)
    if not moves:
        return None
    person, reason = random.choice(moves)
    return _transfer(db, person, reason)


def _death_people(db: Session):
    return _people(db, acuity="critical", min_stay=2, kind=None)


def _death_one(db: Session):
    people = _death_people(db)
    if not people:
        return None
    return _die(db, random.choice(people))


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
        stay_ticks=0,
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
    return _discharge_patient(db, random.choice(people))


def _discharge_patient(db: Session, patient: Patient):
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


def _people(db: Session, floor_id=None, dept=None, prefix=None, acuity=None, stable=False, needs_or=None, kind="bed", min_stay=None):
    stmt = select(Patient).join(Room).where(Room.status != "blocked")
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
    if min_stay is not None:
        stmt = stmt.where(Patient.stay_ticks >= min_stay)
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
    patient.stay_ticks = 0
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


def reserve_room(db: Session, room_id: str, hold_for: str) -> str | None:
    name = (hold_for or "").strip()
    if not name:
        return "Say who the bed is held for."
    with write_lock:
        room = db.get(Room, room_id)
        if room is None:
            return "That room is not on the census."
        if room.patient is not None or room.status != "available":
            return "Only an open bed can be reserved."
        room.status = "reserved"
        room.hold_for = name[:80]
        _log(db, name[:80], f"{room.id} reserved for {name[:80]}", room.id, "move")
        db.commit()
    return None


def release_room(db: Session, room_id: str) -> str | None:
    with write_lock:
        room = db.get(Room, room_id)
        if room is None:
            return "That room is not on the census."
        if room.status != "reserved":
            return "This bed is not reserved."
        who = room.hold_for or "Hold"
        room.status = "available"
        room.hold_for = None
        _log(db, who, f"{room.id} hold released", room.id, "move")
        db.commit()
    return None


def assign_housekeeper(db: Session, room_id: str, keeper_id: int) -> str | None:
    with write_lock:
        room = db.get(Room, room_id)
        keeper = db.get(Housekeeper, keeper_id)
        if room is None or keeper is None:
            return "Room or housekeeper was not found."
        if room.status != "cleaning":
            return "That room is not waiting on a clean."
        if keeper.room_id and keeper.room_id != room.id:
            return f"{keeper.name} is already on {keeper.room_id}."
        for other in db.scalars(select(Housekeeper).where(Housekeeper.room_id == room.id)).all():
            if other.id != keeper.id:
                other.room_id = None
        keeper.room_id = room.id
        _log(db, keeper.name, f"{keeper.name} assigned to {room.id}", room.id, "clean")
        db.commit()
    return None


def complete_clean(db: Session, room_id: str) -> tuple[str | None, bool]:
    with write_lock:
        room = db.get(Room, room_id)
        if room is None:
            return "That room is not on the census.", False
        if room.status != "cleaning":
            return "That room is not in cleaning.", False
        room.ticks_left = 0
        keeper_name = None
        for keeper in db.scalars(select(Housekeeper).where(Housekeeper.room_id == room.id)).all():
            keeper_name = keeper.name
            keeper.room_id = None
        opened = _try_open(db, room, keeper_name)
        db.commit()
        if opened:
            return None, True
        return "Linen is still out. The bed stays closed until clean linen is here.", False


def open_incident(db: Session, room_id: str, title: str, severity: str) -> tuple[str | None, int | None]:
    label = (title or "").strip()
    if not label:
        return "Describe the incident.", None
    if severity not in {"low", "medium", "high", "critical"}:
        return "Severity is not recognized.", None
    with write_lock:
        room = db.get(Room, room_id)
        if room is None:
            return "That room is not on the census.", None
        existing = db.scalar(
            select(Incident).where(Incident.room_id == room.id, Incident.status == "open")
        )
        if existing is not None or room.status == "blocked":
            return "This room already has an open incident.", None
        baseline = room.status
        incident = Incident(
            room_id=room.id,
            title=label[:200],
            severity=severity,
            status="open",
            baseline_status=baseline,
        )
        db.add(incident)
        room.status = "blocked"
        db.flush()
        _log(db, "Command", f"{room.id} blocked — {label[:120]}", room.id, "move")
        db.commit()
        incident_id = incident.id
    return None, incident_id


def resolve_incident(db: Session, incident_id: int) -> str | None:
    with write_lock:
        incident = db.get(Incident, incident_id)
        if incident is None:
            return "Incident was not found."
        if incident.status != "open":
            return "That incident is already closed."
        room = db.get(Room, incident.room_id)
        if room is not None and room.status == "blocked":
            room.status = incident.baseline_status or "available"
        incident.status = "resolved"
        incident.resolved_at = datetime.now(timezone.utc)
        _log(
            db,
            "Command",
            f"{incident.room_id} incident closed — restored {incident.baseline_status}",
            incident.room_id,
            "move",
        )
        db.commit()
    return None
