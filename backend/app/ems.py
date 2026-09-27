"""EMS layer: ambulance pre-alerts, the hospital's answer, and regional routing.

Tiger Memorial's capacity is read from the live census. Partner hospitals and ambulance
traffic are emulated, so the network behaves like a regional system on a normal day.
Census changes go through the simulator's own locks and helpers (app.sim).
"""

import math
import random
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app import sim
from app.catalog import fresh_patient_name
from app.models import AmbulanceRun, FacilityStatus, Patient, Room

HOME = "Tiger Memorial"
ACTIVE = ("pending", "accepted", "arrived")
# Only people accept an ambulance. A crew waits for our answer until it is this close,
# then takes the patient to the next hospital; the run records who "decided": nobody.
NO_ANSWER_LEAD_SECONDS = 60
NO_ANSWER = "No answer"
# The demo always has at least this many ambulances heading to Tiger Memorial.
MIN_INCOMING = 3
AUTO_HANDOFF_SECONDS = 45
GENERATE_EVERY = (90, 150)

# Fictional agencies; the region is a demo, not a real service area.
AGENCIES = ("Tiger Region EMS", "Riverside Ambulance", "Metro Fire Rescue")

# Region map in a 100 x 100 grid. Minutes of driving are derived from distance.
ZONES = {
    "Downtown": (50, 52),
    "North": (54, 10),
    "East": (90, 50),
    "South": (52, 92),
    "West": (10, 48),
}

HOSPITALS = {
    HOME: {
        "short": "TMH",
        "x": 47, "y": 44,
        "live": True,
        "trauma_level": 2,
        "stroke_center": True,
        "cath_lab": False,
        "ct": True,
        "icu": True,
        "services": "Level II trauma · Primary stroke center · ICU · 2 ORs",
    },
    "County Trauma": {
        "short": "CTR",
        "x": 74, "y": 26,
        "live": False,
        "trauma_level": 1,
        "stroke_center": True,
        "cath_lab": False,
        "ct": True,
        "icu": True,
        "beds": {"ed": 30, "icu": 24, "inpatient": 80, "or": 6},
        "base": 0.83, "phase": 2.1,
        "services": "Level I trauma · Neurosurgery · ICU",
    },
    "Heart Center": {
        "short": "HC",
        "x": 26, "y": 20,
        "live": False,
        "trauma_level": 0,
        "stroke_center": False,
        "cath_lab": True,
        "ct": True,
        "icu": True,
        "beds": {"ed": 14, "icu": 16, "inpatient": 50, "or": 4},
        "base": 0.74, "phase": 4.2,
        "services": "Cath lab 24/7 · Cardiac surgery · Cardiac ICU",
    },
    sim.OUTSIDE_HOSPITAL: {
        "short": "CGH",
        "x": 24, "y": 74,
        "live": False,
        "trauma_level": 0,
        "stroke_center": False,
        "cath_lab": False,
        "ct": True,
        "icu": False,
        "beds": {"ed": 24, "icu": 0, "inpatient": 150, "or": 3},
        "base": 0.78, "phase": 0.0,
        "services": "General emergency · Medicine · CT",
    },
}

COMPLAINTS = ("trauma", "stroke", "cardiac", "respiratory", "general")
COMPLAINT_LABEL = {
    "trauma": "Trauma",
    "stroke": "Suspected stroke",
    "cardiac": "Chest pain / STEMI",
    "respiratory": "Respiratory distress",
    "general": "General medical",
}
# What the crew calls it, by triage level (ESI 1-2, ESI 3, ESI 4-5): an ESI 4 is never a "STEMI".
LEVEL_LABELS = {
    "trauma": ("Major trauma", "Trauma", "Minor injury"),
    "stroke": ("Suspected stroke", "Neuro symptoms", "Neuro symptoms"),
    "cardiac": ("Chest pain / STEMI", "Chest pain", "Chest pain, low risk"),
    "respiratory": ("Respiratory distress", "Shortness of breath", "Minor respiratory"),
    "general": ("Medical emergency", "General medical", "General medical"),
}
SUMMARIES = {
    "trauma": (
        "Motor vehicle collision, suspected femur fracture",
        "Fall from ladder, head strike, GCS 13",
        "Bicycle vs car, abdominal pain, tachycardic",
    ),
    "stroke": (
        "Left-sided weakness and facial droop, onset 40 min ago",
        "Sudden aphasia, last known well 25 min ago",
        "Right arm weakness, slurred speech, onset 1 h ago",
    ),
    "cardiac": (
        "Crushing chest pain, ST elevation on 12-lead",
        "Chest pressure radiating to jaw, diaphoretic",
        "Palpitations and near-syncope, HR irregular",
    ),
    "respiratory": (
        "COPD exacerbation, increased work of breathing",
        "Asthma attack not responding to nebulizer",
        "Pneumonia symptoms, SpO2 low on room air",
    ),
    "general": (
        "Fall at home, forearm laceration",
        "Abdominal pain for 2 days, stable vitals",
        "Dizziness and dehydration, tolerating fluids",
    ),
}
# The sickest calls get the sickest stories, and minor calls minor ones.
URGENT_SUMMARIES = {
    "trauma": SUMMARIES["trauma"],
    "stroke": SUMMARIES["stroke"],
    "cardiac": SUMMARIES["cardiac"][:2],
    "respiratory": (
        "COPD exacerbation, increased work of breathing",
        "Pneumonia symptoms, SpO2 low on room air",
        "Severe asthma attack not responding to nebulizer",
    ),
    "general": (
        "Found unresponsive at home, GCS 9",
        "Suspected sepsis: fever, confusion, low blood pressure",
        "Syncope with low blood pressure, not fully alert",
    ),
}
MID_SUMMARIES = {
    "trauma": ("Motor vehicle collision, suspected femur fracture", "Fall down stairs, wrist deformity, stable vitals"),
    "stroke": ("Dizziness and unsteady walking since this morning", "Headache and blurred vision, neuro exam normal"),
    "cardiac": ("Palpitations and near-syncope, HR irregular", "Chest tightness on exertion, settled with rest"),
    "respiratory": ("Asthma attack improving after nebulizer", "Pneumonia symptoms, mildly low oxygen"),
    "general": SUMMARIES["general"],
}
MINOR_SUMMARIES = {
    "trauma": ("Ankle injury after a fall, walking with help", "Forearm laceration from kitchen knife, bleeding controlled"),
    "stroke": ("Brief arm numbness, now resolved", "Dizziness and headache, neuro exam normal"),
    "cardiac": ("Palpitations, now in normal rhythm", "Chest wall pain after lifting, stable ECG"),
    "respiratory": ("Cough and mild fever for 3 days", "Mild asthma, improved with inhaler"),
    "general": SUMMARIES["general"],
}
# Offloads longer than this are server downtime, not a real wait at the door.
STALE_OFFLOAD_SECONDS = 900
CATCH_UP_SECONDS = 120

ESI_WEIGHTS = ((1, 5), (2, 25), (3, 45), (4, 20), (5, 5))
ACUITY_BY_ESI = {1: "critical", 2: "warning"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def drive_minutes(zone: str, hospital: str) -> int:
    zx, zy = ZONES.get(zone, ZONES["Downtown"])
    spot = HOSPITALS[hospital]
    return max(3, round(math.dist((zx, zy), (spot["x"], spot["y"])) * 0.2 + 2))


def summary_for(esi: int, complaint: str, rng: random.Random) -> str:
    pool = URGENT_SUMMARIES if esi <= 2 else MINOR_SUMMARIES if esi >= 4 else MID_SUMMARIES
    return rng.choice(pool[complaint])


def complaint_label(complaint: str, esi: int) -> str:
    labels = LEVEL_LABELS.get(complaint)
    if not labels:
        return COMPLAINT_LABEL.get(complaint, complaint)
    return labels[0 if esi <= 2 else 1 if esi == 3 else 2]


def needs_for(esi: int, complaint: str) -> list[str]:
    urgent = esi <= 2
    return {
        "trauma": ["Trauma bay", "CT", "OR on standby"] if urgent else ["Fast track", "X-ray"] if esi >= 4 else ["ED bed", "X-ray"],
        "stroke": ["CT now", "Stroke team"] + (["ICU likely"] if urgent else []),
        "cardiac": ["Cath lab", "Cardiology"] if urgent else ["Monitored bed", "ECG"],
        "respiratory": ["ICU bed", "Respiratory therapy"] if urgent else ["Monitored bed"],
        "general": ["Resus bay", "Labs & ECG"] if urgent else ["Fast track"] if esi >= 4 else ["ED bed"],
    }[complaint]


# ---------- Facility status ----------

def facility(db: Session) -> FacilityStatus:
    row = db.get(FacilityStatus, 1)
    if row is None:
        row = FacilityStatus(id=1, ems_status="accepting")
        db.add(row)
        db.flush()
    return row


def set_status(db: Session, status: str, reason: str | None, actor: str) -> FacilityStatus:
    if status not in ("accepting", "diverting"):
        raise ValueError("Status must be accepting or diverting.")
    row = facility(db)
    changed = row.ems_status != status
    row.ems_status = status
    row.reason = (reason or "").strip()[:160] or None
    row.updated_by = actor
    row.updated_at = _now()
    if changed:
        message = (
            f"{HOME} is now diverting ambulances — {row.reason or 'capacity'}"
            if status == "diverting"
            else f"{HOME} is accepting ambulances again"
        )
        sim._log(db, "Command", message, None, "ems")
    db.commit()
    return row


# ---------- Capacity ----------

def _level(open_beds: int, total: int) -> str:
    if total == 0:
        return "none"
    if open_beds == 0:
        return "full"
    if open_beds == 1 or open_beds / total < 0.15:
        return "limited"
    return "open"


def _unit(label: str, total: int, open_beds: int) -> dict:
    used = total - open_beds
    return {
        "label": label,
        "total": total,
        "open": open_beds,
        "occupancy_pct": round(used / total * 100) if total else 0,
        "level": _level(open_beds, total),
    }


def home_capacity(db: Session) -> dict:
    rooms = db.scalars(select(Room).where(Room.kind.in_(("bed", "or")))).all()
    occupied = {room_id for (room_id,) in db.execute(select(Patient.room_id)).all()}

    def free(room):
        return room.status == "available" and room.id not in occupied

    ed = [room for room in rooms if room.dept == "ed"]
    icu = [room for room in rooms if room.dept == "icu"]
    ward = [room for room in rooms if room.dept in ("med", "surgward")]
    theatre = [room for room in rooms if room.kind == "or"]
    incoming = db.scalar(
        select(func.count()).select_from(AmbulanceRun)
        .where(AmbulanceRun.destination == HOME, AmbulanceRun.status.in_(("pending", "accepted", "arrived")))
    ) or 0
    units = {
        "ed": _unit("Emergency", len(ed), sum(1 for room in ed if free(room))),
        "icu": _unit("Intensive care", len(icu), sum(1 for room in icu if free(room))),
        "inpatient": _unit("Inpatient beds", len(ward), sum(1 for room in ward if free(room))),
        "or": _unit("Operating rooms", len(theatre), sum(1 for room in theatre if free(room))),
    }
    ed_load = units["ed"]["occupancy_pct"] / 100
    return {"units": units, "incoming": incoming, "ed_wait_min": round(8 + max(0.0, ed_load - 0.5) * 90)}


def partner_capacity(name: str, now: datetime) -> dict:
    """Emulated feed: each unit swings slowly around the hospital's usual level."""
    spot = HOSPITALS[name]
    minute = now.timestamp() / 60
    units = {}
    for index, (unit, label) in enumerate(
        (("ed", "Emergency"), ("icu", "Intensive care"), ("inpatient", "Inpatient beds"), ("or", "Operating rooms"))
    ):
        total = spot["beds"][unit]
        share = spot["base"] + 0.09 * math.sin(2 * math.pi * minute / (34 + index * 7) + spot["phase"] + index)
        share = min(1.0, max(0.35, share))
        units[unit] = _unit(label, total, 0 if total == 0 else max(0, round(total * (1 - share))))
    ed_load = units["ed"]["occupancy_pct"] / 100
    return {"units": units, "incoming": None, "ed_wait_min": round(8 + max(0.0, ed_load - 0.5) * 90)}


def hospital_status(db: Session, name: str, now: datetime) -> dict:
    spot = HOSPITALS[name]
    capacity = home_capacity(db) if spot["live"] else partner_capacity(name, now)
    if spot["live"]:
        row = facility(db)
        status, reason = row.ems_status, row.reason
    else:
        full = capacity["units"]["ed"]["occupancy_pct"] >= 95
        status, reason = ("diverting", "Emergency department at capacity") if full else ("accepting", None)
    return {
        "name": name,
        "short": spot["short"],
        "data": "live" if spot["live"] else "emulated",
        "ems_status": status,
        "reason": reason,
        "services": spot["services"],
        "capabilities": {
            "trauma_level": spot["trauma_level"],
            "stroke_center": spot["stroke_center"],
            "cath_lab": spot["cath_lab"],
            "ct": spot["ct"],
            "icu": spot["icu"],
        },
        "position": {"x": spot["x"], "y": spot["y"]},
        **capacity,
    }


def network(db: Session) -> list[dict]:
    now = _now()
    return [hospital_status(db, name, now) for name in HOSPITALS]


# ---------- Routing ----------

def recommend(db: Session, esi: int, complaint: str, zone: str) -> list[dict]:
    """Rank hospitals for one patient: capability first, then capacity, then drive time."""
    if complaint not in COMPLAINTS:
        raise ValueError("Unknown complaint.")
    if zone not in ZONES:
        raise ValueError("Unknown zone.")
    esi = min(5, max(1, int(esi)))
    needs_icu = esi <= 2 and complaint in ("trauma", "stroke", "cardiac", "respiratory")
    hospitals = network(db)

    def capable(hospital):
        caps = hospital["capabilities"]
        if complaint == "trauma" and esi <= 3:
            return caps["trauma_level"] > 0
        if complaint == "stroke":
            return caps["stroke_center"] and caps["ct"]
        if complaint == "cardiac" and esi <= 2:
            return caps["cath_lab"]
        return True

    nearest_capable = min(
        (hospital["name"] for hospital in hospitals if capable(hospital)),
        key=lambda name: drive_minutes(zone, name),
        default=None,
    )
    ranked = []
    for hospital in hospitals:
        caps, units = hospital["capabilities"], hospital["units"]
        minutes = drive_minutes(zone, hospital["name"])
        reasons, blocked = [], False

        if complaint == "trauma" and esi <= 3:
            if caps["trauma_level"]:
                reasons.append({"ok": True, "text": f"Level {'I' * caps['trauma_level']} trauma center"})
            else:
                reasons.append({"ok": False, "text": "Not a trauma center"})
                blocked = True
        if complaint == "stroke":
            if caps["stroke_center"]:
                reasons.append({"ok": True, "text": "Stroke center · CT ready"})
            else:
                reasons.append({"ok": False, "text": "No stroke center"})
                blocked = True
        if complaint == "cardiac" and esi <= 2:
            if caps["cath_lab"]:
                reasons.append({"ok": True, "text": "Cath lab available"})
            else:
                reasons.append({"ok": False, "text": "No cath lab"})
                blocked = True
        if needs_icu:
            if units["icu"]["open"] > 0:
                reasons.append({"ok": True, "text": f"{units['icu']['open']} ICU beds open"})
            else:
                reasons.append({"ok": False, "text": "No ICU" if units["icu"]["total"] == 0 else "ICU full"})
                blocked = True
        if units["ed"]["open"] > 0:
            reasons.append({"ok": True, "text": f"{units['ed']['open']} ED beds open · ~{hospital['ed_wait_min']} min wait"})
        else:
            reasons.append({"ok": False, "text": "No open ED bed"})
        if hospital["ems_status"] == "diverting":
            if esi == 1 and hospital["name"] == nearest_capable:
                reasons.append({"ok": True, "text": "On diversion, overridden: ESI 1 goes to the nearest capable hospital"})
            else:
                reasons.append({"ok": False, "text": "On ambulance diversion"})
                blocked = True

        score = minutes + units["ed"]["occupancy_pct"] / 10 + (12 if units["ed"]["open"] == 0 else 0)
        if complaint == "trauma" and esi <= 2 and caps["trauma_level"] == 2:
            score += 6  # Level I preferred for the sickest trauma
        ranked.append({
            "hospital": hospital["name"],
            "short": hospital["short"],
            "data": hospital["data"],
            "eligible": not blocked,
            "drive_minutes": minutes,
            "score": round(score, 1),
            "reasons": reasons,
            "ems_status": hospital["ems_status"],
        })
    ranked.sort(key=lambda row: (not row["eligible"], row["score"]))
    return ranked


# ---------- Runs ----------

def _code(run_id: int) -> str:
    return f"RUN-{run_id:04d}"


def _vitals(esi: int, rng: random.Random) -> dict:
    if esi == 1:
        return {"heart_rate": rng.randint(118, 142), "systolic": rng.randint(78, 96), "diastolic": rng.randint(40, 58),
                "spo2": rng.randint(84, 91), "respiratory_rate": rng.randint(26, 34)}
    if esi == 2:
        return {"heart_rate": rng.randint(96, 118), "systolic": rng.randint(150, 190), "diastolic": rng.randint(88, 104),
                "spo2": rng.randint(91, 95), "respiratory_rate": rng.randint(20, 26)}
    return {"heart_rate": rng.randint(72, 96), "systolic": rng.randint(118, 142), "diastolic": rng.randint(70, 88),
            "spo2": rng.randint(95, 99), "respiratory_rate": rng.randint(14, 20)}


def suggest_bed(db: Session, esi: int, complaint: str, exclude: set[str] | None = None) -> str | None:
    """Best open Emergency bed for this triage level."""
    taken = {room_id for (room_id,) in db.execute(select(Patient.room_id)).all()} | (exclude or set())
    beds = [
        room for room in db.scalars(
            select(Room).where(Room.dept == "ed", Room.kind == "bed", Room.status == "available").order_by(Room.id)
        ).all()
        if room.id not in taken
    ]
    if not beds:
        return None
    if esi == 1:
        order = ("ED-T", "ER-T", "ED-", "ER-", "OBS-")
    elif esi == 2:
        order = ("ED-", "ED-T", "ER-", "OBS-")
    elif esi == 3:
        order = ("ED-", "OBS-", "ER-", "FAST-")
    else:
        order = ("FAST-", "OBS-", "ED-", "ER-")
    for prefix in order:
        for room in beds:
            if room.id.startswith(prefix) and not (prefix == "ED-" and room.id.startswith("ED-T")):
                return room.id
    # The sickest never go to fast track: no suitable bed means make room or divert.
    return beds[0].id if esi >= 3 else None


def _held_beds(db: Session) -> set[str]:
    return {
        bed for (bed,) in db.execute(
            select(AmbulanceRun.bed_id).where(AmbulanceRun.status.in_(ACTIVE), AmbulanceRun.bed_id.is_not(None))
        ).all()
    }


def create_run(
    db: Session,
    *,
    esi: int,
    complaint: str,
    zone: str,
    destination: str = HOME,
    summary: str | None = None,
    eta_minutes: int | None = None,
    actor: str = "EMS",
    simulated: bool = False,
    rng: random.Random | None = None,
) -> AmbulanceRun:
    if destination not in HOSPITALS:
        raise ValueError("Unknown destination.")
    if complaint not in COMPLAINTS or zone not in ZONES:
        raise ValueError("Unknown complaint or zone.")
    rng = rng or random.Random()
    esi = min(5, max(1, int(esi)))
    now = _now()
    taken = set(db.scalars(select(Patient.name)).all()) | set(
        db.scalars(select(AmbulanceRun.patient_name).where(AmbulanceRun.status.in_(ACTIVE))).all()
    )
    minutes = eta_minutes if eta_minutes else drive_minutes(zone, destination) + rng.randint(0, 2)
    # No two ambulances on the road share a unit name.
    on_road = set(db.scalars(select(AmbulanceRun.unit).where(
        or_(AmbulanceRun.status.in_(ACTIVE), and_(AmbulanceRun.status == "diverted", AmbulanceRun.handed_off_at.is_(None)))
    )).all())
    free_units = [f"Medic {number}" for number in range(2, 30) if f"Medic {number}" not in on_road]
    run = AmbulanceRun(
        code="RUN-NEW",
        unit=rng.choice(free_units) if free_units else f"Medic {rng.randint(2, 29)}",
        agency=rng.choice(AGENCIES),
        zone=zone,
        esi=esi,
        complaint=complaint,
        summary=(summary or summary_for(esi, complaint, rng))[:200],
        patient_name=fresh_patient_name(taken, rng.randrange(10_000)),
        age=rng.randint(19, 88),
        destination=destination,
        status="pending",
        decided_by=None if destination == HOME else destination,
        simulated=simulated,
        eta_at=now + timedelta(minutes=max(1, minutes)),
        **_vitals(esi, rng),
    )
    db.add(run)
    db.flush()
    run.code = _code(run.id)
    if destination == HOME:
        run.bed_id = suggest_bed(db, esi, complaint, _held_beds(db))
        sim._log(
            db,
            run.unit,
            f"{run.unit} pre-alert: ESI {esi} {complaint_label(complaint, esi).lower()}, ETA {max(1, minutes)} min",
            None,
            "ems",
        )
    else:
        # Partner hospitals answer through their own systems; emulated as an immediate accept.
        run.status = "accepted"
        run.responded_at = now
    db.commit()
    return run


def accept(db: Session, run: AmbulanceRun, bed_id: str | None, actor: str) -> AmbulanceRun:
    if run.destination != HOME or run.status != "pending":
        raise ValueError("Only a pending pre-alert to this hospital can be accepted.")
    others = _held_beds(db) - {run.bed_id}
    choice = bed_id or run.bed_id or suggest_bed(db, run.esi, run.complaint, others)
    if choice in others:
        choice = suggest_bed(db, run.esi, run.complaint, others)
    if not choice:
        raise ValueError("No open Emergency bed. Divert this ambulance.")
    problem = sim.reserve_room(db, choice, f"EMS {run.unit} · {run.patient_name}")
    if problem:
        fallback = suggest_bed(db, run.esi, run.complaint, others | {choice})
        if bed_id or not fallback or sim.reserve_room(db, fallback, f"EMS {run.unit} · {run.patient_name}"):
            raise ValueError(problem)
        choice = fallback
    db.refresh(run)
    run.bed_id = choice
    run.status = "accepted"
    run.responded_at = _now()
    run.decided_by = actor
    sim._log(db, run.unit, f"{run.unit} accepted to {choice} · {run.code}", choice, "ems")
    db.commit()
    return run


def divert(db: Session, run: AmbulanceRun, to: str | None, actor: str) -> AmbulanceRun:
    if run.destination != HOME or run.status not in ("pending", "accepted"):
        raise ValueError("Only an incoming ambulance that has not arrived can be diverted.")
    if to is not None and (to not in HOSPITALS or to == HOME):
        raise ValueError("Pick a partner hospital.")
    if to is None:
        options = [row for row in recommend(db, run.esi, run.complaint, run.zone) if row["hospital"] != HOME]
        to = next((row["hospital"] for row in options if row["eligible"]), options[0]["hospital"])
    if run.status == "accepted" and run.bed_id:
        room = db.get(Room, run.bed_id)
        if room is not None and room.status == "reserved":
            sim.release_room(db, run.bed_id)
        db.refresh(run)
    run.status = "diverted"
    run.diverted_to = to
    run.responded_at = run.responded_at or _now()
    run.decided_by = actor
    run.eta_at = _now() + timedelta(minutes=drive_minutes(run.zone, to))
    sim._log(db, run.unit, f"{run.unit} diverted to {to} · {run.code}", run.bed_id, "ems")
    db.commit()
    return run


def arrive(db: Session, run: AmbulanceRun, at: datetime | None = None) -> AmbulanceRun:
    run.status = "arrived"
    run.arrived_at = at or _now()
    sim._log(db, run.unit, f"{run.unit} arrived at EMS bay · {run.code}", run.bed_id, "ems")
    db.commit()
    return run


def handoff(db: Session, run: AmbulanceRun, actor: str, at: datetime | None = None) -> AmbulanceRun:
    """Patient leaves the stretcher for the reserved bed: a real admission in the census."""
    if run.destination != HOME or run.status not in ("accepted", "arrived"):
        raise ValueError("Only an ambulance at this hospital can hand off.")
    if run.status == "accepted":
        arrive(db, run)
    with sim.write_lock:
        sim._serialize(db)
        run = db.get(AmbulanceRun, run.id)
        bed = db.get(Room, run.bed_id) if run.bed_id else None
        occupied = {room_id for (room_id,) in db.execute(select(Patient.room_id)).all()}
        if bed is None or bed.id in occupied or bed.status not in ("reserved", "available"):
            spare = suggest_bed(db, run.esi, run.complaint, _held_beds(db))
            bed = db.get(Room, spare) if spare else None
        if bed is None:
            db.rollback()
            raise ValueError("No bed is free for this patient yet.")
        names = set(db.scalars(select(Patient.name)).all())
        name = run.patient_name if run.patient_name not in names else fresh_patient_name(names, run.id)
        acuity = ACUITY_BY_ESI.get(run.esi, "normal")
        physician, nurse = sim.next_crew(db, "ed")
        reading = sim.vital_set(acuity, run.id)
        reading.update({
            key: value for key, value in (
                ("heart_rate", run.heart_rate),
                ("systolic", run.systolic),
                ("diastolic", run.diastolic),
                ("spo2", run.spo2),
                ("respiratory_rate", run.respiratory_rate),
            ) if value is not None
        })
        db.add(Patient(
            name=name,
            acuity=acuity,
            room_id=bed.id,
            needs_or=run.complaint == "trauma" and run.esi == 1,
            physician=physician,
            nurse=nurse,
            age=run.age,
            chief_complaint=run.summary,
            diagnosis=f"{complaint_label(run.complaint, run.esi)} · ED workup",
            stay_ticks=0,
            **reading,
        ))
        bed.status = acuity
        bed.hold_for = None
        sim._clear_clean(bed)
        run.bed_id = bed.id
        run.status = "handed_off"
        run.handed_off_at = at or _now()
        run.decided_by = run.decided_by or actor
        sim._log(db, name, f"{name} admitted to {bed.id} from {run.unit}", bed.id, "admit")
        sim._commit(db)
    return run


# ---------- Autopilot ----------

_next_generation = {"at": 0.0}


def _weighted_esi(rng: random.Random) -> int:
    return rng.choices([esi for esi, _ in ESI_WEIGHTS], weights=[weight for _, weight in ESI_WEIGHTS])[0]


def tick(db: Session, rng: random.Random | None = None, generate: bool = True) -> list[str]:
    """Advance every active run and, now and then, send a new ambulance into the region."""
    rng = rng or random.Random()
    now = _now()
    notes = []
    for run in db.scalars(select(AmbulanceRun).where(AmbulanceRun.status.in_(ACTIVE)).order_by(AmbulanceRun.id)).all():
        eta, arrived = _aware(run.eta_at), _aware(run.arrived_at)
        try:
            if run.destination != HOME:
                if now >= eta:
                    run.status = "handed_off"
                    run.arrived_at = run.handed_off_at = now
                    db.commit()
                continue
            if run.status == "pending" and (eta - now).total_seconds() <= NO_ANSWER_LEAD_SECONDS:
                divert(db, run, None, NO_ANSWER)
                notes.append(f"{run.code}: no answer, crew went elsewhere")
            elif run.status == "accepted" and now >= eta:
                late = (now - eta).total_seconds() > CATCH_UP_SECONDS
                arrive(db, run, at=eta if late else None)
                notes.append(f"{run.code} arrived")
            elif run.status == "arrived" and arrived and (now - arrived).total_seconds() >= AUTO_HANDOFF_SECONDS:
                late = (now - arrived).total_seconds() > AUTO_HANDOFF_SECONDS + CATCH_UP_SECONDS
                handoff(db, run, "auto", at=arrived + timedelta(seconds=AUTO_HANDOFF_SECONDS) if late else None)
                notes.append(f"{run.code} handed off")
        except ValueError:
            db.rollback()

    # Diverted ambulances finish their trip at the partner hospital.
    for run in db.scalars(select(AmbulanceRun).where(AmbulanceRun.status == "diverted", AmbulanceRun.handed_off_at.is_(None))).all():
        if now >= _aware(run.eta_at):
            run.handed_off_at = now
    db.commit()

    # A bed held for an ambulance that is no longer coming goes back to the pool.
    # Pending runs count too: accept() reserves the bed a moment before the run turns accepted.
    coming = {
        f"EMS {run.unit} · {run.patient_name}"[:80]
        for run in db.scalars(select(AmbulanceRun).where(AmbulanceRun.status.in_(ACTIVE))).all()
    }
    for room in db.scalars(select(Room).where(Room.status == "reserved", Room.hold_for.like("EMS %"))).all():
        if room.hold_for not in coming:
            sim.release_room(db, room.id)
            notes.append(f"released stale hold on {room.id}")

    if generate:
        # Top up: never fewer than MIN_INCOMING ambulances on their way to this hospital.
        incoming = db.scalar(
            select(func.count()).select_from(AmbulanceRun)
            .where(AmbulanceRun.destination == HOME, AmbulanceRun.status.in_(ACTIVE))
        ) or 0
        for _ in range(max(0, MIN_INCOMING - incoming)):
            zone = rng.choice(list(ZONES))
            complaint = rng.choice(COMPLAINTS)
            create_run(db, esi=_weighted_esi(rng), complaint=complaint, zone=zone, simulated=True, rng=rng)
            notes.append("new run to keep the queue at three")

    if generate and not _next_generation["at"]:
        _next_generation["at"] = time.time() + 20  # first regional ambulance shortly after startup
    elif generate and time.time() >= _next_generation["at"]:
        zone = rng.choice(list(ZONES))
        complaint = rng.choice(COMPLAINTS)
        esi = _weighted_esi(rng)
        best = recommend(db, esi, complaint, zone)[0]["hospital"]
        create_run(db, esi=esi, complaint=complaint, zone=zone, destination=best, simulated=True, rng=rng)
        notes.append(f"new run to {best}")
        if best != HOME and rng.random() < 0.6:
            # Keep the home hospital busy too: a second, lower-acuity run in from its closest zone.
            create_run(db, esi=rng.choice((3, 3, 4, 5)), complaint="general", zone="Downtown", simulated=True, rng=rng)
        _next_generation["at"] = time.time() + rng.randint(*GENERATE_EVERY)
    return notes


# ---------- Read models ----------

def _offload(arrived: datetime | None, handed: datetime | None) -> int | None:
    if not arrived or not handed:
        return None
    seconds = round((handed - arrived).total_seconds())
    return seconds if 0 <= seconds <= STALE_OFFLOAD_SECONDS else None


def run_payload(run: AmbulanceRun, now: datetime | None = None) -> dict:
    now = now or _now()
    eta = _aware(run.eta_at)
    arrived, handed = _aware(run.arrived_at), _aware(run.handed_off_at)
    target = run.diverted_to or run.destination
    return {
        "id": run.id,
        "code": run.code,
        "unit": run.unit,
        "agency": run.agency,
        "zone": run.zone,
        "esi": run.esi,
        "complaint": run.complaint,
        "complaint_label": complaint_label(run.complaint, run.esi),
        "summary": run.summary,
        "patient_name": run.patient_name,
        "age": run.age,
        "vitals": {
            "heart_rate": run.heart_rate,
            "systolic": run.systolic,
            "diastolic": run.diastolic,
            "spo2": run.spo2,
            "respiratory_rate": run.respiratory_rate,
        },
        "needs": needs_for(run.esi, run.complaint),
        "destination": run.destination,
        "target": target,
        "status": run.status,
        "bed_id": run.bed_id,
        "diverted_to": run.diverted_to,
        "decided_by": run.decided_by,
        "simulated": run.simulated,
        "eta_at": eta.isoformat() if eta else None,
        "eta_seconds": max(0, round((eta - now).total_seconds())) if eta else None,
        "created_at": _aware(run.created_at).isoformat() if run.created_at else None,
        "responded_at": _aware(run.responded_at).isoformat() if run.responded_at else None,
        "arrived_at": arrived.isoformat() if arrived else None,
        "handed_off_at": handed.isoformat() if handed else None,
        "offload_seconds": _offload(arrived, handed),
        "route": {
            "from": dict(zip(("x", "y"), ZONES.get(run.zone, ZONES["Downtown"]))),
            "to": {"x": HOSPITALS[target]["x"], "y": HOSPITALS[target]["y"]},
        },
    }


def summary(db: Session) -> dict:
    now = _now()
    day_ago = now - timedelta(hours=24)
    home_runs = db.scalars(
        select(AmbulanceRun).where(AmbulanceRun.destination == HOME, AmbulanceRun.created_at >= day_ago)
    ).all()
    en_route = [run for run in home_runs if run.status in ("pending", "accepted")]
    offloads = [
        seconds
        for run in home_runs
        if run.status == "handed_off"
        and (seconds := _offload(_aware(run.arrived_at), _aware(run.handed_off_at))) is not None
    ]
    return {
        "en_route": len(en_route),
        "pending": sum(1 for run in home_runs if run.status == "pending"),
        "arriving_10": sum(1 for run in en_route if (_aware(run.eta_at) - now).total_seconds() <= 600),
        "at_bay": sum(1 for run in home_runs if run.status == "arrived"),
        "arrivals_24h": sum(1 for run in home_runs if run.status == "handed_off"),
        "diverted_24h": sum(1 for run in home_runs if run.status == "diverted"),
        "offload_avg_seconds": round(sum(offloads) / len(offloads)) if offloads else None,
        "status": facility(db).ems_status,
    }
