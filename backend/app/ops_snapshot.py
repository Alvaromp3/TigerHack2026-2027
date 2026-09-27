"""One operations picture for Command, Reports context, and the president chat."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import HospitalState, Housekeeper, Incident, Room, Staff, Transfer

OCCUPIED = {"critical", "warning", "normal"}
TICK_SECONDS = 9
NURSE_LOAD = 4


def build_ops(db: Session) -> dict:
    now = datetime.now(timezone.utc)
    state = db.get(HospitalState, 1)
    tick = state.tick_count if state is not None else 0
    rooms = db.scalars(select(Room).options(selectinload(Room.patient)).order_by(Room.id)).all()
    keepers = db.scalars(select(Housekeeper).order_by(Housekeeper.id)).all()
    staff = db.scalars(select(Staff).order_by(Staff.unit, Staff.name)).all()
    incidents = db.scalars(
        select(Incident).where(Incident.status == "open").order_by(Incident.id.desc())
    ).all()
    transfers = db.scalars(select(Transfer).order_by(Transfer.id.desc()).limit(20)).all()
    keeper_by_room = {keeper.room_id: keeper for keeper in keepers if keeper.room_id}

    census = [room for room in rooms if room.kind in {"bed", "or"}]
    usable = [room for room in census if room.status == "available"]

    items = []
    items.extend(_cleans(census, keeper_by_room, tick))
    items.extend(_incident_items(incidents, now))
    items.extend(_transfer_items(transfers, now))
    items.extend(_closed_units(census))
    items.extend(_coverage(census, staff))
    items.sort(key=lambda item: (-item["impact"], 0 if item["age_seconds"] is None else -item["age_seconds"], item["id"]))

    return {
        "surge": bool(state and state.surge),
        "incoming_notice": state.incoming_notice if state is not None else None,
        "called_physicians": state.called_physicians if state is not None else 0,
        "diverted_count": state.diverted_count if state is not None else 0,
        "demo_room_id": state.demo_room_id if state is not None else None,
        "tick": tick,
        "counts": {
            "usable": len(usable),
            "transfers": sum(1 for item in items if item["kind"] == "transfer"),
            "cleans": sum(1 for item in items if item["kind"] == "clean"),
            "incidents": len(incidents),
        },
        "items": items,
        "usable": [_room_ref(room) for room in usable],
        "holds": [_hold(room) for room in census if room.status == "reserved"],
        "housekeepers": [
            {
                "id": keeper.id,
                "name": keeper.name,
                "room_id": keeper.room_id,
            }
            for keeper in keepers
        ],
        "staff": [_staff_row(person, census) for person in staff],
        "units": _unit_summary(census, staff),
        "pending": _pending(census, transfers, now),
        "beds": _bed_facts(census),
    }


def _room_ref(room: Room) -> dict:
    return {
        "room_id": room.id,
        "floor_id": room.floor_id,
        "dept": room.dept,
        "kind": room.kind,
        "status": room.status,
    }


def _hold(room: Room) -> dict:
    return {
        **_room_ref(room),
        "hold_for": room.hold_for or "Hold",
    }


def _cleans(rooms, keeper_by_room, tick: int) -> list[dict]:
    rows = []
    for room in rooms:
        if room.status != "cleaning" or room.id in keeper_by_room:
            continue
        age = None
        if room.queued_tick is not None:
            age = max(0, (tick - room.queued_tick) * TICK_SECONDS)
        linen_ready = room.linen_stage == "ready"
        if linen_ready:
            reason = "Clean finished. Waiting to open the bed."
        elif (room.ticks_left or 0) <= 0:
            reason = "Linen is still out. The bed stays closed."
        else:
            reason = "No housekeeper assigned."
        if room.hold_for:
            reason = f"{room.hold_for} is waiting on this bed. {reason}"
        rows.append({
            "id": f"clean:{room.id}",
            "kind": "clean",
            "floor_id": room.floor_id,
            "room_id": room.id,
            "title": f"{room.id} needs a clean",
            "reason": reason,
            "age_seconds": age,
            "impact": 70,
            "nav": "live",
            "linen_ready": linen_ready,
        })
    return rows


def _incident_items(incidents, now: datetime) -> list[dict]:
    weight = {"critical": 100, "high": 84, "medium": 64, "low": 44}
    rows = []
    for incident in incidents:
        rows.append({
            "id": f"incident:{incident.id}",
            "kind": "incident",
            "floor_id": None,
            "room_id": incident.room_id,
            "title": incident.title,
            "reason": f"{incident.severity} · bed out of service",
            "age_seconds": _age(incident.created_at, now),
            "impact": weight.get(incident.severity, 50),
            "nav": "incidents",
            "severity": incident.severity,
            "incident_id": incident.id,
        })
    return rows


def _transfer_items(transfers, now: datetime) -> list[dict]:
    rows = []
    for transfer in transfers:
        label = _transfer_reason(transfer.reason)
        rows.append({
            "id": f"transfer:{transfer.id}",
            "kind": "transfer",
            "floor_id": None,
            "room_id": None,
            "title": f"{transfer.patient_name} sent to {transfer.destination}",
            "reason": label,
            "age_seconds": _age(transfer.created_at, now),
            "impact": 75,
            "nav": "flow",
        })
    return rows


def _closed_units(rooms) -> list[dict]:
    groups = [
        ("icu", "Intensive Care", 95, lambda room: room.dept == "icu" and room.kind == "bed"),
        ("ed", "Emergency", 90, lambda room: room.dept == "ed" and room.kind == "bed"),
        ("or", "Operating rooms", 88, lambda room: room.kind == "or"),
    ]
    rows = []
    for unit_id, label, impact, match in groups:
        members = [room for room in rooms if match(room)]
        if not members:
            continue
        if any(room.status == "available" for room in members):
            continue
        rows.append({
            "id": f"unit:{unit_id}",
            "kind": "unit",
            "floor_id": members[0].floor_id,
            "room_id": None,
            "title": f"{label} has no open bed",
            "reason": f"{len(members)} beds, none usable",
            "age_seconds": None,
            "impact": impact,
            "nav": "capacity",
        })
    return rows


def _unit_summary(rooms, staff) -> list[dict]:
    groups = (
        ("ed", "Emergency", lambda room: room.dept == "ed"),
        ("icu", "Intensive Care", lambda room: room.dept == "icu"),
        ("med", "Medical", lambda room: room.dept == "med"),
        ("surg", "Surgery", lambda room: room.dept in {"surgward", "surgery"} or room.kind == "or"),
    )
    rows = []
    for unit, label, match in groups:
        occupied = [room for room in rooms if match(room) and room.status in OCCUPIED]
        nurses = [person for person in staff if person.unit == unit and person.role == "nurse" and person.on_duty]
        ratio = None if not nurses else round(len(occupied) / len(nurses), 1)
        rows.append({
            "id": unit,
            "label": label,
            "nurses": len(nurses),
            "patients": len(occupied),
            "ratio": ratio,
        })
    return rows


def _coverage(rooms, staff) -> list[dict]:
    groups = {
        "icu": lambda room: room.dept == "icu",
        "ed": lambda room: room.dept == "ed",
        "med": lambda room: room.dept == "med",
        "surg": lambda room: room.dept in {"surgward", "surgery"} or room.kind == "or",
    }
    rows = []
    for unit, match in groups.items():
        occupied = [room for room in rooms if match(room) and room.status in OCCUPIED]
        nurses = [person for person in staff if person.unit == unit and person.role == "nurse" and person.on_duty]
        if not occupied:
            continue
        ratio = None if not nurses else round(len(occupied) / len(nurses), 1)
        thin = not nurses or len(occupied) > NURSE_LOAD * len(nurses)
        if not thin:
            continue
        if not nurses:
            reason = f"{len(occupied)} patients and no nurse on duty. Rule: 1 nurse per {NURSE_LOAD} patients."
        else:
            reason = (
                f"{len(occupied)} patients for {len(nurses)} nurses "
                f"({ratio} each). Rule: no more than {NURSE_LOAD}."
            )
        rows.append({
            "id": f"coverage:{unit}",
            "kind": "coverage",
            "floor_id": occupied[0].floor_id,
            "room_id": None,
            "title": f"{unit.upper()} coverage is thin",
            "reason": reason,
            "age_seconds": None,
            "impact": 58,
            "nav": "staff",
            "unit": unit,
        })
    return rows


def _staff_row(person: Staff, rooms) -> dict:
    owned = []
    if person.on_duty and person.role in {"nurse", "physician", "charge"}:
        owned = [
            room.id
            for room in rooms
            if room.patient is not None and (
                room.patient.nurse == person.name or room.patient.physician == person.name
            )
        ]
    return {
        "id": person.id,
        "name": person.name,
        "role": person.role,
        "unit": person.unit,
        "specialty": person.specialty,
        "shift": person.shift,
        "on_duty": person.on_duty,
        "extension": person.extension,
        "patients": owned,
    }


def _pending(rooms, transfers, now: datetime) -> list[dict]:
    rows = []
    for room in rooms:
        if room.status == "reserved":
            rows.append({
                "id": f"hold:{room.id}",
                "kind": "reserve",
                "room_id": room.id,
                "floor_id": room.floor_id,
                "title": f"{room.id} held for {room.hold_for or 'a patient'}",
                "reason": "Reserved. Not usable until released.",
            })
    or_open = any(room.kind == "or" and room.status == "available" for room in rooms)
    if not or_open:
        waiting = db_patients_needing_or(rooms)
        for room in waiting:
            patient = room.patient
            rows.append({
                "id": f"or:{room.id}",
                "kind": "or_wait",
                "room_id": room.id,
                "floor_id": room.floor_id,
                "title": f"{patient.name} needs an operating room",
                "reason": "Both operating rooms are in use.",
            })
    icu_open = any(room.dept == "icu" and room.kind == "bed" and room.status == "available" for room in rooms)
    if not icu_open:
        for room in rooms:
            if room.dept == "icu" or room.status != "critical" or room.patient is None:
                continue
            rows.append({
                "id": f"icu:{room.id}",
                "kind": "icu_wait",
                "room_id": room.id,
                "floor_id": room.floor_id,
                "title": f"{room.patient.name} is critical outside the ICU",
                "reason": "Intensive Care has no open bed.",
            })
    for transfer in transfers:
        label = _transfer_reason(transfer.reason)
        rows.append({
            "id": f"transfer:{transfer.id}",
            "kind": "transfer",
            "room_id": None,
            "floor_id": None,
            "title": f"{transfer.patient_name} sent to {transfer.destination}",
            "reason": label,
            "age_seconds": _age(transfer.created_at, now),
        })
    return rows


def _bed_facts(rooms) -> list[dict]:
    rows = []
    for room in rooms:
        patient = room.patient
        if patient is None:
            continue
        pressure = None
        if patient.systolic is not None and patient.diastolic is not None:
            pressure = f"{patient.systolic}/{patient.diastolic}"
        rows.append({
            "room_id": room.id,
            "patient": patient.name,
            "age": patient.age,
            "complaint": patient.chief_complaint,
            "diagnosis": patient.diagnosis,
            "physician": patient.physician,
            "nurse": patient.nurse,
            "heart_rate": patient.heart_rate,
            "blood_pressure": pressure,
            "spo2": patient.spo2,
            "respiratory_rate": patient.respiratory_rate,
            "temperature": None if patient.temperature is None else patient.temperature / 10,
        })
    return rows


def _transfer_reason(reason: str) -> str:
    if reason == "icu_full":
        return "ICU full"
    if reason == "incoming":
        return "Sent to another hospital"
    return "ORs full"


def db_patients_needing_or(rooms) -> list[Room]:
    waiting = []
    for room in rooms:
        patient = room.patient
        if patient is None or not patient.needs_or or room.kind == "or":
            continue
        waiting.append(room)
    return waiting


def _age(stamp: datetime | None, now: datetime) -> int | None:
    if stamp is None:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return max(0, int((now - stamp).total_seconds()))
