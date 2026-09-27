"""One weighted clinical movement every tick, plus the housekeeping queue."""

import logging
import random
import threading
from datetime import datetime, timezone

from sqlalchemy import select, text
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
    Staff,
    Transfer,
)

log = logging.getLogger(__name__)
write_lock = threading.Lock()
# Postgres advisory key: one census writer across every running instance.
# A deploy runs the old and new server side by side, and both tick.
CENSUS_LOCK = 742027
TICK_SECONDS = 9
SURGE_TICK_SECONDS = 2
DIVERT_BATCH = 6
OUTSIDE_HOSPITAL = "County General"
DEMO_ROOM = "ED-06"
DEMO_WAITING = "Jordan Hale"
CALLBACKS = (
    ("Dr. Helen Cho", "physician", "surg", "Orthopedics", "night", "3104"),
    ("Dr. Sara Nguyen", "physician", "ed", "Emergency medicine", "callback", "1110"),
    ("Dr. Marcus Hale", "physician", "icu", "Critical care", "callback", "4110"),
    ("Dr. Priya Nair", "physician", "surg", "Trauma surgery", "callback", "3110"),
)
CLEAN_TICKS = {"stat": 2, "standard": 4, "terminal": 8}
LINEN_STAGE_TICKS = {"pickup": 1, "wash": 2, "deliver": 1}
LINEN_NEXT = {"pickup": "wash", "wash": "deliver"}
LINEN_ACTIVE = ("pickup", "wash", "deliver")
ISOLATION_MARKERS = ("sepsis", "c. diff", "c.diff", "covid", "mrsa", "tb", "tubercul", "isolation")


def tick(db: Session):
    # Take a pooled connection before the write lock. Waiting on the pool
    # while holding the lock stalls every other writer.
    db.connection()
    with write_lock:
        if not _serialize(db, wait=False):
            return None
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
        _commit(db)
        return action or cleaned


def _serialize(db: Session, wait: bool = True) -> bool:
    """Take the census write lock for this transaction. Commit or rollback releases it."""
    if wait:
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": CENSUS_LOCK})
    elif not db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": CENSUS_LOCK}):
        return False
    # Rows read before the lock may be stale; read them again under it.
    db.expire_all()
    return True


def _commit(db: Session):
    fixed = reconcile_census(db)
    if fixed:
        log.warning("census reconciled: %s", "; ".join(fixed))
    db.commit()


def reconcile_census(db: Session) -> list[str]:
    """Make every room agree with who is in it. Returns one note per room it fixed.

    Occupied (critical, warning, normal) means a patient is in the room, and a bed
    shows that patient's acuity. Available, cleaning and reserved mean nobody is.
    A bed a patient left goes to cleaning, never straight to available.
    Blocked rooms keep their status until the incident is resolved.
    """
    db.flush()
    rooms = list(db.scalars(select(Room).order_by(Room.id)).all())
    occupants = {patient.room_id: patient for patient in db.scalars(select(Patient)).all()}
    fixed = []
    queued = False
    for room in rooms:
        patient = occupants.get(room.id)
        if room.status == "blocked":
            continue
        if patient is not None:
            if room.kind == "or":
                want = room.status if room.status in OCCUPIED else "warning"
            else:
                want = patient.acuity if patient.acuity in OCCUPIED else "normal"
            if room.status != want:
                fixed.append(f"{room.id} {room.status} -> {want}, {patient.name} is in it")
                room.status = want
            if room.hold_for or room.clean_type or room.ticks_left is not None or room.linen_stage:
                room.hold_for = None
                _clear_clean(room)
            continue
        if room.status in OCCUPIED:
            fixed.append(f"{room.id} {room.status} -> cleaning, nobody is in it")
            room.status = "cleaning"
            _stamp_clean(db, room, "")
            queued = True
        elif room.status == "cleaning":
            if room.ticks_left is None:
                _stamp_clean(db, room, "")
                queued = True
            elif room.linen_stage is None:
                _start_linen(db, room)
                queued = True
        elif room.status in ("available", "reserved"):
            stale_hold = room.status == "available" and room.hold_for
            if stale_hold or room.clean_type or room.ticks_left is not None or room.linen_stage:
                fixed.append(f"{room.id} {room.status} had leftover turnover data")
                _clear_clean(room)
                if stale_hold:
                    room.hold_for = None
    cleaning = {room.id: room for room in rooms if room.status == "cleaning"}
    for keeper in db.scalars(select(Housekeeper)).all():
        if keeper.room_id and keeper.room_id not in cleaning:
            keeper.room_id = None
            queued = True
    for aide in db.scalars(select(LinenAide)).all():
        room = cleaning.get(aide.room_id) if aide.room_id else None
        if aide.room_id and (room is None or room.linen_stage not in LINEN_ACTIVE):
            aide.room_id = None
            queued = True
    state = db.get(HospitalState, 1)
    if state is not None and state.demo_room_id and state.demo_room_id not in cleaning:
        state.demo_room_id = None
        queued = True
    if queued:
        _assign_housekeepers(db)
        _assign_linen(db)
    return fixed


def tick_seconds(db: Session) -> int:
    state = db.get(HospitalState, 1)
    if state is not None and state.surge:
        return SURGE_TICK_SECONDS
    return TICK_SECONDS


def call_physicians(db: Session) -> int:
    with write_lock:
        _serialize(db)
        state = db.get(HospitalState, 1)
        if state is None:
            raise ValueError("The hospital census is not ready.")
        if state.called_physicians:
            return state.called_physicians
        brought = 0
        for name, role, unit, specialty, shift, extension in CALLBACKS:
            person = db.scalar(select(Staff).where(Staff.name == name))
            if person is None:
                person = Staff(
                    name=name,
                    role=role,
                    unit=unit,
                    specialty=specialty,
                    shift=shift,
                    on_duty=False,
                    extension=extension,
                )
                db.add(person)
                db.flush()
            if not person.on_duty:
                person.on_duty = True
                brought += 1
        state.called_physicians = brought or len(CALLBACKS)
        _log(db, "Command", f"Called in {state.called_physicians} physicians.", None, "move")
        _commit(db)
        return state.called_physicians


def divert_overflow(db: Session) -> int:
    with write_lock:
        _serialize(db)
        state = db.get(HospitalState, 1)
        if state is None:
            raise ValueError("The hospital census is not ready.")
        people = _ed_patients(db)
        random.shuffle(people)
        sent = 0
        for patient in people[:DIVERT_BATCH]:
            if _send_outside(db, patient):
                sent += 1
        state.diverted_count = (state.diverted_count or 0) + sent
        if sent:
            _log(
                db,
                "Command",
                f"Diverted {sent} emergency patients to {OUTSIDE_HOSPITAL}.",
                None,
                "divert",
            )
        _commit(db)
        return sent


def reset_demo(db: Session) -> str:
    with write_lock:
        _serialize(db)
        state = db.get(HospitalState, 1)
        if state is None:
            raise ValueError("The hospital census is not ready.")
        state.surge = False
        state.incoming_notice = None
        state.called_physicians = 0
        state.diverted_count = 0
        for name, *_rest in CALLBACKS:
            person = db.scalar(select(Staff).where(Staff.name == name))
            if person is not None:
                person.on_duty = False
        room = _demo_bed(db)
        patient = room.patient
        if patient is not None:
            db.delete(patient)
            db.flush()
            db.expire(room, ["patient"])
        for keeper in db.scalars(select(Housekeeper).where(Housekeeper.room_id == room.id)).all():
            keeper.room_id = None
        for aide in db.scalars(select(LinenAide).where(LinenAide.room_id == room.id)).all():
            aide.room_id = None
        room.status = "cleaning"
        room.hold_for = DEMO_WAITING
        _stamp_clean(db, room, "")
        for keeper in db.scalars(select(Housekeeper).where(Housekeeper.room_id == room.id)).all():
            keeper.room_id = None
        state.demo_room_id = room.id
        keepers = list(db.scalars(select(Housekeeper).order_by(Housekeeper.id)).all())
        if keepers and not any(keeper.room_id is None for keeper in keepers):
            keepers[-1].room_id = None
        _log(
            db,
            DEMO_WAITING,
            f"{DEMO_WAITING} is waiting on {room.id}. The bed is not usable until the clean finishes.",
            room.id,
            "move",
        )
        _commit(db)
        return room.id


ADMIT_SITES = (("F1", "ED"), ("F1", "FAST"), ("F1", "OBS"), ("F3", "ER"))
WEIGHTS = {"admit": 30, "transfer": 25, "or": 15, "discharge": 25, "divert": 10, "death": 8}
# One tick is 9 seconds. A patient stays put until that stretch is finished.
STAY_BOARD = 12
STAY_BEFORE_OR = 16
STAY_IN_OR = 40
STAY_RECOVER = 30
STAY_ICU = 24
STAY_OBS = 20


def _advance_stay(db: Session):
    for patient in db.scalars(select(Patient)).all():
        patient.stay_ticks = (patient.stay_ticks or 0) + 1
        if patient.acuity != "warning" or patient.stay_ticks < STAY_BOARD:
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

    state = db.get(HospitalState, 1)
    if state is not None and state.surge:
        offer(90, _ed_beds(db), _admit_critical)
    else:
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
        person for person in _people(db, floor_id="F1", acuity="critical", min_stay=STAY_BOARD)
        if person.room and person.room.id.startswith(("ED", "FAST", "OBS"))
    ]
    people.extend(_people(db, floor_id="F3", prefix="ER", acuity="critical", min_stay=STAY_BOARD))
    return people


def _boarding_stable(db: Session):
    return [
        person for person in _people(db, floor_id="F1", stable=True, min_stay=STAY_BOARD)
        if person.room and person.room.id.startswith(("ED", "FAST"))
    ]


def _transfer_moves(db: Session):
    moves = []
    if _beds(db, floor_id="F3", dept="icu"):
        moves.extend(("icu", person) for person in _boarding_critical(db))
    if _med_beds(db):
        moves.extend(("floor", person) for person in _boarding_stable(db))
        for person in _people(db, floor_id="F3", dept="icu", min_stay=STAY_ICU):
            if person.acuity in ("normal", "warning"):
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
    waiting = list(_people(db, floor_id="F2", dept="med", needs_or=True, min_stay=STAY_BEFORE_OR))
    waiting.extend(_people(db, floor_id="F3", dept="med", prefix="MS", needs_or=True, min_stay=STAY_BEFORE_OR))
    return waiting


def _or_moves(db: Session):
    moves = []
    if _beds(db, kind="or"):
        moves.extend(("in", person) for person in _surgical_waiting(db))
    if _beds(db, floor_id="F4", dept="surgward"):
        moves.extend(("out", person) for person in _people(db, kind="or", min_stay=STAY_IN_OR))
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
    dest = random.choice(beds)
    return _move(
        db,
        person,
        dest,
        f"{person.name} left the OR for {dest.id}",
        expect_kind="or",
        settle="normal",
    )


def _discharge_people(db: Session):
    people = list(_people(db, floor_id="F2", dept="med", acuity="normal", needs_or=False, min_stay=STAY_RECOVER))
    people.extend(_people(db, floor_id="F3", dept="med", prefix="MS", acuity="normal", needs_or=False, min_stay=STAY_RECOVER))
    people.extend(_people(db, floor_id="F4", dept="surgward", acuity="normal", needs_or=False, min_stay=STAY_RECOVER))
    people.extend(_people(db, floor_id="F1", prefix="OBS", acuity="normal", needs_or=False, min_stay=STAY_OBS))
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
    return _people(db, floor_id="F3", dept="icu", acuity="critical", min_stay=STAY_ICU)


def _death_one(db: Session):
    people = _death_people(db)
    if not people:
        return None
    return _die(db, random.choice(people))


def vital_set(acuity: str, salt: int) -> dict:
    """One stored reading. Temperature is tenths of a degree (384 means 38.4)."""
    pick = random.Random(salt)
    if acuity == "critical":
        return {
            "heart_rate": pick.randint(110, 138),
            "systolic": pick.randint(78, 96),
            "diastolic": pick.randint(48, 62),
            "spo2": pick.randint(88, 93),
            "respiratory_rate": pick.randint(24, 32),
            "temperature": pick.randint(380, 392),
        }
    if acuity == "warning":
        return {
            "heart_rate": pick.randint(96, 112),
            "systolic": pick.randint(138, 162),
            "diastolic": pick.randint(86, 100),
            "spo2": pick.randint(93, 96),
            "respiratory_rate": pick.randint(20, 24),
            "temperature": pick.randint(374, 382),
        }
    return {
        "heart_rate": pick.randint(68, 90),
        "systolic": pick.randint(108, 132),
        "diastolic": pick.randint(68, 84),
        "spo2": pick.randint(96, 99),
        "respiratory_rate": pick.randint(14, 18),
        "temperature": pick.randint(365, 372),
    }


def fill_missing_vitals(db: Session):
    missing = db.scalars(select(Patient).where(Patient.heart_rate.is_(None))).all()
    for patient in missing:
        values = vital_set(patient.acuity or "normal", patient.id or 0)
        patient.heart_rate = values["heart_rate"]
        patient.systolic = values["systolic"]
        patient.diastolic = values["diastolic"]
        patient.spo2 = values["spo2"]
        patient.respiratory_rate = values["respiratory_rate"]
        patient.temperature = values["temperature"]


def _ed_beds(db: Session):
    beds = []
    for floor_id, prefix in ADMIT_SITES:
        beds.extend(_beds(db, floor_id=floor_id, prefix=prefix))
    return beds


def _admit_critical(db: Session):
    beds = _ed_beds(db)
    if not beds:
        return None
    return _receive(db, random.choice(beds), "critical")


def _ed_patients(db: Session):
    people = []
    for person in db.scalars(select(Patient).join(Room)).unique().all():
        room = person.room
        if room is None or room.kind != "bed" or room.dept != "ed" or room.status == "blocked":
            continue
        people.append(person)
    return people


def _admit(db: Session, floor_id: str, prefix: str):
    beds = _beds(db, floor_id=floor_id, prefix=prefix)
    if not beds:
        return None
    acuity = random.choice(("critical", "warning", "normal"))
    return _receive(db, random.choice(beds), acuity)


def _receive(db: Session, bed: Room, acuity: str):
    state = db.get(HospitalState, 1)
    if state is None:
        return None
    state.admit_index += 1
    taken = set(db.scalars(select(Patient.name)).all())
    name = fresh_patient_name(taken, random.randrange(10_000))
    team = "icu" if bed.dept == "icu" else "ed"
    physician, nurse = crew(team, random.randrange(2))
    case = clinical_case(name, acuity, state.admit_index)
    patient = Patient(
        name=name,
        acuity=acuity,
        room_id=bed.id,
        needs_or=acuity == "critical" and random.random() < 0.35,
        physician=physician,
        nurse=nurse,
        age=case["age"],
        chief_complaint=case["chief_complaint"],
        diagnosis=case["diagnosis"],
        stay_ticks=0,
        **vital_set(acuity, state.admit_index),
    )
    db.add(patient)
    bed.status = acuity
    bed.hold_for = None
    _clear_clean(bed)
    _log(db, name, f"{name} admitted to {bed.id}", bed.id, "admit")
    return f"admit {name}"


def _send_outside(db: Session, patient: Patient):
    patient = _claim(db, patient)
    if patient is None:
        return False
    room = db.get(Room, patient.room_id)
    if room is None:
        return False
    name = patient.name
    room_id = room.id
    clinical = _clinical_text(patient)
    db.add(Transfer(
        patient_name=name,
        destination=OUTSIDE_HOSPITAL,
        reason="incoming",
    ))
    db.delete(patient)
    room.hold_for = None
    _vacate(db, room, clinical)
    _log(db, name, f"{name} diverted from {room_id} to {OUTSIDE_HOSPITAL}", room_id, "divert")
    return True


def _demo_bed(db: Session) -> Room:
    room = db.get(Room, DEMO_ROOM)
    if room is not None and room.kind == "bed":
        return room
    fallback = db.scalars(
        select(Room).where(Room.floor_id == "F1", Room.dept == "ed", Room.kind == "bed").order_by(Room.id)
    ).first()
    if fallback is None:
        raise ValueError("No emergency bed to stage.")
    return fallback


def _shift(db: Session, people, beds, label: str):
    if not people or not beds:
        return None
    patient = random.choice(people)
    dest = random.choice(beds)
    if label == "OR":
        message = f"{patient.name} in {dest.id}"
        expect_kind = "bed"
    else:
        message = f"{patient.name} moved to {label} {dest.id}"
        expect_kind = None
    return _move(db, patient, dest, message, expect_kind=expect_kind)


def _leave_or(db: Session):
    people = _people(db, kind="or", min_stay=STAY_IN_OR)
    beds = _beds(db, floor_id="F4", dept="surgward")
    if not people or not beds:
        return None
    patient = random.choice(people)
    dest = random.choice(beds)
    return _move(
        db,
        patient,
        dest,
        f"{patient.name} left the OR for {dest.id}",
        expect_kind="or",
        settle="normal",
    )


def _discharge_pool(db: Session, floor_id: str, dept=None, prefix=None):
    if prefix == "OBS":
        return _people(db, floor_id=floor_id, prefix=prefix, stable=True, needs_or=False)
    return _people(db, floor_id=floor_id, dept=dept, acuity="normal", needs_or=False)


def _discharge(db: Session, floor_id: str, dept=None, prefix=None):
    people = _discharge_pool(db, floor_id, dept, prefix)
    if not people:
        return None
    return _discharge_patient(db, random.choice(people))


def _claim(db: Session, patient: Patient) -> Patient | None:
    """Lock one patient so two ticks cannot move them twice."""
    if patient is None or patient.id is None:
        return None
    return db.scalar(
        select(Patient).where(Patient.id == patient.id).with_for_update(skip_locked=True)
    )


def _discharge_patient(db: Session, patient: Patient):
    patient = _claim(db, patient)
    if patient is None:
        return None
    room = db.get(Room, patient.room_id)
    if room is None or room.kind == "or":
        return None
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
    patient = _claim(db, patient)
    if patient is None:
        return None
    room = db.get(Room, patient.room_id)
    if room is None or room.dept != "icu":
        return None
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


def repair_census(db: Session) -> list[str]:
    """Startup pass: fix whatever an older build or an interrupted tick left behind."""
    with write_lock:
        _serialize(db)
        fixed = reconcile_census(db)
        _assign_housekeepers(db)
        _assign_linen(db)
        db.commit()
    if fixed:
        log.warning("census repaired at startup: %s", "; ".join(fixed))
    return fixed


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
    room.hold_for = None
    _clear_clean(room)
    state = db.get(HospitalState, 1)
    if state is not None and state.demo_room_id == room.id:
        state.demo_room_id = None
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
    state = db.get(HospitalState, 1)
    held = state.demo_room_id if state is not None else None
    if held:
        waiting = [room for room in waiting if room.id != held]
    free = [keeper for keeper in keepers if not keeper.room_id]
    if held and free:
        free = free[:-1]
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


def _move(db: Session, patient: Patient, dest: Room, message: str, expect_kind: str | None = None, settle: str | None = None):
    patient = _claim(db, patient)
    if patient is None:
        return None
    origin = db.get(Room, patient.room_id)
    if origin is None or origin.id == dest.id:
        return None
    if expect_kind and origin.kind != expect_kind:
        return None
    if (patient.stay_ticks or 0) < 1:
        return None
    dest = db.scalar(
        select(Room).where(Room.id == dest.id, Room.status == "available").with_for_update(skip_locked=True)
    )
    if dest is None or db.scalar(select(Patient.id).where(Patient.room_id == dest.id)):
        return None
    if settle:
        patient.acuity = settle
        patient.needs_or = False
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
    kind = "or" if dest.kind == "or" or origin.kind == "or" else "move"
    _log(db, patient.name, message, dest.id, kind)
    return message


def _transfer(db: Session, patient: Patient, reason: str):
    patient = _claim(db, patient)
    if patient is None:
        return None
    room = db.get(Room, patient.room_id)
    if room is None or room.kind == "or":
        return None
    destination = DESTINATIONS[reason]
    name = patient.name
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
        _serialize(db)
        room = db.get(Room, room_id)
        if room is None:
            return "That room is not on the census."
        if room.patient is not None or room.status != "available":
            return "Only an open bed can be reserved."
        room.status = "reserved"
        room.hold_for = name[:80]
        _log(db, name[:80], f"{room.id} reserved for {name[:80]}", room.id, "move")
        _commit(db)
    return None


def release_room(db: Session, room_id: str) -> str | None:
    with write_lock:
        _serialize(db)
        room = db.get(Room, room_id)
        if room is None:
            return "That room is not on the census."
        if room.status != "reserved":
            return "This bed is not reserved."
        who = room.hold_for or "Hold"
        room.status = "available"
        room.hold_for = None
        _log(db, who, f"{room.id} hold released", room.id, "move")
        _commit(db)
    return None


def assign_housekeeper(db: Session, room_id: str, keeper_id: int) -> str | None:
    with write_lock:
        _serialize(db)
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
        state = db.get(HospitalState, 1)
        if state is not None and state.demo_room_id == room.id:
            state.demo_room_id = None
        _log(db, keeper.name, f"{keeper.name} assigned to {room.id}", room.id, "clean")
        _commit(db)
    return None


def discharge_room(db: Session, room_id: str) -> str | None:
    """Discharge the patient in one bed on command. The bed goes into turnover."""
    with write_lock:
        _serialize(db)
        room = db.get(Room, room_id)
        if room is None:
            return "That room was not found."
        patient = room.patient
        if patient is None:
            return "Nobody is in that bed."
        if room.kind == "or":
            return "Patients leave the OR through recovery, not discharge."
        if patient.acuity == "critical":
            return f"{patient.name} is critical and cannot be discharged."
        if _discharge_patient(db, patient) is None:
            return "That patient is already moving. Try again."
        _commit(db)
    return None


def complete_clean(db: Session, room_id: str) -> tuple[str | None, bool]:
    with write_lock:
        _serialize(db)
        room = db.get(Room, room_id)
        if room is None:
            return "That room is not on the census.", False
        if room.status != "cleaning":
            return "That room is not in cleaning.", False
        room.ticks_left = 0
        room.linen_stage = "ready"
        room.linen_ticks = 0
        keeper_name = None
        for keeper in db.scalars(select(Housekeeper).where(Housekeeper.room_id == room.id)).all():
            keeper_name = keeper.name
            keeper.room_id = None
        for aide in db.scalars(select(LinenAide).where(LinenAide.room_id == room.id)).all():
            if keeper_name is None:
                keeper_name = aide.name
            aide.room_id = None
        opened = _try_open(db, room, keeper_name)
        _commit(db)
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
        _serialize(db)
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
        _commit(db)
        incident_id = incident.id
    return None, incident_id


def resolve_incident(db: Session, incident_id: int) -> str | None:
    with write_lock:
        _serialize(db)
        incident = db.get(Incident, incident_id)
        if incident is None:
            return "Incident was not found."
        if incident.status != "open":
            return "That incident is already closed."
        room = db.get(Room, incident.room_id)
        if room is not None and room.status == "blocked":
            # The baseline is a starting point; who is in the bed now decides the status.
            room.status = incident.baseline_status or "available"
            reconcile_census(db)
        incident.status = "resolved"
        incident.resolved_at = datetime.now(timezone.utc)
        restored = room.status if room is not None else incident.baseline_status
        _log(
            db,
            "Command",
            f"{incident.room_id} incident closed — restored {restored}",
            incident.room_id,
            "move",
        )
        _commit(db)
    return None
