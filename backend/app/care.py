"""What is being done to each patient right now.

In an operating room: the operation, chosen from the patient's diagnosis, with the attending as
surgeon. Everywhere else: the current step of a short care pathway for the unit and the diagnosis
(an ED stroke gets a CT, then neuro checks, then the thrombolysis decision). Steps advance on
their own and start over when a patient changes rooms.

Stored in care_activities, so the live map, the assistant and the API all read the same rows.
Only this module writes that table, so it never waits on the simulator's locks.
"""

import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import sim
from app.models import CareActivity, Patient, Room

# Real minutes a case spends in theatre in this simulation (the simulator's own stay in the OR).
SURGERY_MINUTES = max(2, round(sim.STAY_IN_OR * sim.TICK_SECONDS / 60))
STEP_MINUTES = (2, 4)

# First match on the diagnosis wins.
PROCEDURES = (
    ("STEMI", "Coronary artery bypass graft (CABG)"),
    ("Polytrauma", "Damage-control laparotomy"),
    ("femoral neck", "Hip hemiarthroplasty"),
    ("Ankle fracture", "Ankle ORIF, plate and screws"),
    ("appendicitis", "Laparoscopic appendectomy"),
    ("Cervical spine", "Anterior cervical decompression and fusion"),
    ("Penetrating abdominal", "Exploratory laparotomy"),
    ("pancreatitis", "Laparoscopic cholecystectomy"),
    ("Laceration", "Tendon repair and wound closure"),
    ("burns", "Burn excision and skin graft"),
    ("AV block", "Permanent pacemaker implant"),
    ("stroke", "Carotid endarterectomy"),
    ("Urosepsis", "Cystoscopy and ureteral stent"),
    ("Sepsis", "Source control: abscess drainage"),
    ("miscarriage", "Dilation and curettage"),
)
# Diagnoses with no operation of their own still get a plausible general-surgery case.
GENERAL_SURGERY = (
    "Laparoscopic cholecystectomy",
    "Inguinal hernia repair",
    "Small bowel resection",
    "Diagnostic laparoscopy",
)

FAMILIES = (
    ("cardiac", ("STEMI", "Atrial fibrillation", "AV block")),
    ("stroke", ("stroke", "SAH")),
    ("trauma", ("Polytrauma", "Penetrating", "Cervical spine", "fracture", "Laceration", "burns", "Crush")),
    ("respiratory", ("pneumonia", "asthma")),
    ("sepsis", ("Sepsis", "Urosepsis")),
    ("metabolic", ("DKA", "pancreatitis")),
    ("neuro", ("seizure", "migraine")),
    ("toxic", ("overdose", "Anaphylaxis")),
    ("obstetric", ("miscarriage",)),
    ("surgical", ("appendicitis",)),
)

PATHWAYS = {
    "ed": {
        "cardiac": ("12-lead ECG and troponin", "Aspirin and heparin given", "Cardiology at the bedside"),
        "stroke": ("CT head and CT angiogram", "Neuro checks every 15 min", "Thrombolysis decision with neurology"),
        "trauma": ("Primary survey (ABCDE)", "FAST ultrasound", "CT trauma scan", "Splinting and pain control"),
        "respiratory": ("Chest X-ray", "Nebulizer and oxygen", "IV antibiotics started"),
        "sepsis": ("Blood cultures and lactate", "IV fluid bolus", "Broad-spectrum antibiotics"),
        "metabolic": ("Blood gas and electrolytes", "Insulin infusion started", "IV fluids and antiemetics"),
        "neuro": ("Neuro exam", "IV antiepileptic loading dose", "Dark room and IV analgesia"),
        "toxic": ("Naloxone given, airway watched", "Cardiac monitoring", "Toxicology labs"),
        "obstetric": ("Pelvic ultrasound", "Blood type and Rh check", "Obstetrics consult"),
        "surgical": ("Abdominal CT", "IV antibiotics", "Surgical consult, nil by mouth"),
        "other": ("Triage reassessment", "Labs drawn", "Awaiting results"),
    },
    "icu": {
        "cardiac": ("Arterial line monitoring", "Heparin drip titration", "Echo at the bedside"),
        "stroke": ("Hourly neuro checks", "Blood pressure control", "Swallow screen"),
        "trauma": ("Blood transfusion", "Chest drain check", "Repeat CT"),
        "sepsis": ("Vasopressor titration", "Repeat lactate", "Antibiotic dose"),
        "other": ("Ventilator and sedation check", "Vasopressor titration", "Central line care", "Hourly vitals and neuro"),
    },
    "ward": {
        "pre_op": ("Pre-op checklist and consent", "Nil by mouth, IV fluids", "Anesthesia review"),
        "post_op": ("Post-op observations", "Pain control (PCA pump)", "Early mobilization with physio", "Wound dressing check"),
        "other": ("Medication round", "IV antibiotics", "Physiotherapy walk", "Discharge planning"),
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment: datetime | None) -> datetime | None:
    if moment is not None and moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def _pick(seed: str, count: int) -> int:
    return int(hashlib.sha1(seed.encode()).hexdigest(), 16) % count


def family(diagnosis: str | None) -> str:
    text = (diagnosis or "").lower()
    for name, words in FAMILIES:
        if any(word.lower() in text for word in words):
            return name
    return "other"


def procedure_for(diagnosis: str | None, patient_id: int) -> str:
    text = (diagnosis or "").lower()
    for word, name in PROCEDURES:
        if word.lower() in text:
            return name
    return GENERAL_SURGERY[_pick(f"op-{patient_id}", len(GENERAL_SURGERY))]


def pathway_for(kind: str, dept: str, diagnosis: str | None, needs_or: bool) -> tuple[str, ...]:
    if kind == "or":
        return ()
    if dept == "icu":
        table = PATHWAYS["icu"]
        return table.get(family(diagnosis), table["other"])
    if dept in ("med", "surgward"):
        table = PATHWAYS["ward"]
        if needs_or:
            return table["pre_op"]
        return table["post_op"] if dept == "surgward" else table["other"]
    table = PATHWAYS["ed"]
    return table.get(family(diagnosis), table["other"])


def _step_minutes(patient_id: int, step: int) -> int:
    low, high = STEP_MINUTES
    return low + _pick(f"step-{patient_id}-{step}", high - low + 1)


def _plan(patient_id: int, room_id: str, kind: str, dept: str, diagnosis: str | None, needs_or: bool, step: int = 0):
    if kind == "or":
        return {"kind": "surgery", "title": procedure_for(diagnosis, patient_id), "step": 0, "steps": 1, "minutes": SURGERY_MINUTES}
    path = pathway_for(kind, dept, diagnosis, needs_or)
    step %= len(path)
    return {"kind": "care", "title": path[step], "step": step, "steps": len(path), "minutes": _step_minutes(patient_id, step)}


def refresh(db: Session) -> int:
    """Give every patient in a bed an activity; move care steps along; drop discharged patients."""
    now = _now()
    rows = db.execute(
        select(Patient.id, Patient.room_id, Patient.diagnosis, Patient.needs_or, Room.kind, Room.dept)
        .join(Room, Room.id == Patient.room_id)
    ).all()
    current = {row.patient_id: row for row in db.scalars(select(CareActivity)).all()}
    changed = 0
    for patient_id, room_id, diagnosis, needs_or, kind, dept in rows:
        activity = current.pop(patient_id, None)
        if activity is None or activity.room_id != room_id:
            plan = _plan(patient_id, room_id, kind, dept, diagnosis, bool(needs_or))
            if activity is None:
                activity = CareActivity(patient_id=patient_id, room_id=room_id, started_at=now, **plan)
                db.add(activity)
            else:
                activity.room_id, activity.started_at = room_id, now
                for key, value in plan.items():
                    setattr(activity, key, value)
            changed += 1
            continue
        # Surgery runs until the simulator moves the patient out; care steps take turns.
        if activity.kind == "care" and now >= _aware(activity.started_at) + timedelta(minutes=activity.minutes):
            plan = _plan(patient_id, room_id, kind, dept, diagnosis, bool(needs_or), activity.step + 1)
            for key, value in plan.items():
                setattr(activity, key, value)
            activity.started_at = now
            changed += 1
    if current:
        db.execute(delete(CareActivity).where(CareActivity.patient_id.in_(list(current))))
        changed += len(current)
    db.commit()
    return changed


def by_patient(db: Session) -> dict[int, CareActivity]:
    return {row.patient_id: row for row in db.scalars(select(CareActivity)).all()}


def payload(activity: CareActivity | None, room_id: str | None = None) -> dict:
    # A row left over from the patient's previous room is not what is happening now.
    if activity is None or (room_id is not None and activity.room_id != room_id):
        return {"activity": None, "activity_kind": None, "activity_started_at": None, "activity_minutes": None, "activity_step": None, "activity_steps": None}
    return {
        "activity": activity.title,
        "activity_kind": activity.kind,
        "activity_started_at": _aware(activity.started_at).isoformat(),
        "activity_minutes": activity.minutes,
        "activity_step": activity.step,
        "activity_steps": activity.steps,
    }
