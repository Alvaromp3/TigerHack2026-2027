"""Census rooms that share ids with the floor plate in floors.js."""

MIX = [
    "normal", "available", "warning", "normal", "critical",
    "available", "cleaning", "normal", "available", "warning",
]
ICU = [
    "critical", "normal", "warning", "available", "normal", "critical",
    "available", "normal", "cleaning", "warning", "available", "normal",
]
ED = [
    "critical", "warning", "normal", "available", "critical", "available",
    "normal", "warning", "cleaning", "available", "normal", "available",
]
OCCUPIED = {"critical", "warning", "normal"}

_GIVEN = [
    "Sofia", "James", "Noah", "Amina", "Helen", "Mateo", "Grace", "Owen",
    "Priya", "Samuel", "Lila", "Jonah", "Emma", "Hugo", "Nora", "Eliot",
    "Clara", "Andre", "Maya", "Felix", "Camila", "Hassan", "Ruth", "Diego",
    "Imani", "Lars", "Yara", "Mei", "Paul", "Nina", "Omar", "Leah",
    "Victor", "Asha", "Elena", "Marcus", "Fatima", "Luis", "Hannah", "Kenji",
    "Amara", "Theo", "Rosa", "Daniel", "Ines", "Malik", "Chloe", "Ravi",
]
_FAMILY = [
    "Alvarez", "Whitfield", "Bennett", "Diallo", "Cho", "Ruiz", "Ibrahim", "Clarke",
    "Nair", "Ortiz", "Berg", "Abebe", "Walsh", "Ferreira", "Kim", "March",
    "Voss", "Blake", "Haddad", "Nguyen", "Brooks", "Petrov", "Okeke", "Tanaka",
    "Cohen", "Lang", "Reddy", "Santos", "Moreau", "Keller", "Okada", "Diaz",
]

def _names():
    """Every given+family pair once, with neighboring patients on different surnames."""
    pool = []
    seen = set()
    span = len(_GIVEN) * len(_FAMILY)
    for index in range(span):
        given = _GIVEN[index % len(_GIVEN)]
        family = _FAMILY[(index * 7) % len(_FAMILY)]
        full = f"{given} {family}"
        if full in seen:
            full = next(f"{given} {last}" for last in _FAMILY if f"{given} {last}" not in seen)
        seen.add(full)
        pool.append(full)
    return pool


PATIENTS = _names()

CASES = [
    {"age": 74, "chief_complaint": "Crushing chest pain", "diagnosis": "Anterior STEMI"},
    {"age": 58, "chief_complaint": "Sudden shortness of breath", "diagnosis": "Pulmonary embolism"},
    {"age": 81, "chief_complaint": "Left-sided weakness", "diagnosis": "Acute ischemic stroke"},
    {"age": 46, "chief_complaint": "Right lower quadrant pain", "diagnosis": "Acute appendicitis"},
    {"age": 67, "chief_complaint": "Fever and productive cough", "diagnosis": "Community pneumonia"},
    {"age": 33, "chief_complaint": "Twisted ankle after a fall", "diagnosis": "Ankle fracture"},
    {"age": 52, "chief_complaint": "Worsening asthma overnight", "diagnosis": "Acute asthma"},
    {"age": 70, "chief_complaint": "Black stool and dizziness", "diagnosis": "Upper GI bleed"},
    {"age": 29, "chief_complaint": "Migraine unrelieved at home", "diagnosis": "Status migrainosus"},
    {"age": 63, "chief_complaint": "Painful swollen calf", "diagnosis": "Deep vein thrombosis"},
    {"age": 77, "chief_complaint": "Confusion and low urine output", "diagnosis": "Urosepsis"},
    {"age": 41, "chief_complaint": "Severe epigastric pain", "diagnosis": "Pancreatitis"},
    {"age": 55, "chief_complaint": "Palpitations and near syncope", "diagnosis": "Atrial fibrillation"},
    {"age": 36, "chief_complaint": "Cut hand on broken glass", "diagnosis": "Laceration, needs repair"},
    {"age": 84, "chief_complaint": "Hip pain after a fall", "diagnosis": "Femoral neck fracture"},
    {"age": 48, "chief_complaint": "Burning epigastric pain", "diagnosis": "Peptic ulcer"},
    {"age": 61, "chief_complaint": "High sugars and vomiting", "diagnosis": "Diabetic ketoacidosis"},
    {"age": 22, "chief_complaint": "Ankle sprain playing soccer", "diagnosis": "Lateral ankle sprain"},
    {"age": 72, "chief_complaint": "Wheezing and ankle swelling", "diagnosis": "Heart failure flare"},
    {"age": 39, "chief_complaint": "Gallbladder pain after dinner", "diagnosis": "Cholecystitis"},
]


def random_case():
    import random
    return random.choice(CASES)


def fresh_patient_name(taken: set[str], index: int = 0) -> str:
    """Next unused full name. Never appends a number."""
    for step in range(len(PATIENTS)):
        candidate = PATIENTS[(index + step) % len(PATIENTS)]
        if candidate not in taken:
            return candidate
    raise RuntimeError("patient name pool exhausted")

CREWS = {
    "icu": ("Dr. Leena Patel", ["RN Maya Chen", "RN Chris Novak"]),
    "ed": ("Dr. Jonah Okonkwo", ["RN Elena Brooks", "RN Jonah Blake"]),
    "med": ("Dr. Amir Shah", ["RN Luis Ibarra", "RN Priya Raman"]),
    "surg": ("Dr. Camila Alvarez", ["RN Priya Raman", "RN Luis Ibarra"]),
}

DESTINATIONS = {
    "icu_full": "County Trauma",
    "or_full": "Heart Center",
}


def crew(team, nurse_index=0):
    physician, nurses = CREWS[team]
    return physician, nurses[nurse_index % len(nurses)]


def _tile(prefix, start, cols, rows, dept, floor_id, statuses, team, surge=False):
    rooms = []
    n = 0
    for _row in range(rows):
        for _col in range(cols):
            num = start + n
            room_id = f"{prefix}-{num:02d}" if prefix in ("ED", "ER") else f"{prefix}-{num}"
            rooms.append({
                "id": room_id,
                "floor_id": floor_id,
                "kind": "bed",
                "dept": dept,
                "status": statuses[n % len(statuses)],
                "surge": surge,
                "team": team,
                "nurse_index": n,
            })
            n += 1
    return rooms


def _one(room_id, dept, floor_id, status, team, kind="bed", surge=False, nurse_index=0):
    return {
        "id": room_id,
        "floor_id": floor_id,
        "kind": kind,
        "dept": dept,
        "status": status,
        "surge": surge,
        "team": team,
        "nurse_index": nurse_index,
    }


def census_rooms():
    """Same build order as buildHospital(), so the first names match the plate."""
    rooms = []
    rooms += _tile("SUR", 401, 12, 1, "surgward", "F4", MIX, "surg")
    rooms += _tile("SUR", 413, 12, 1, "surgward", "F4", list(reversed(MIX)), "surg")
    rooms += _tile("ICU", 301, 6, 2, "icu", "F3", ICU, "icu", surge=True)
    rooms.append(_one("OR-1", "surgery", "F3", "warning", "surg", kind="or"))
    rooms.append(_one("OR-2", "surgery", "F3", "available", "surg", kind="or"))
    rooms.append(_one("ER-T1", "ed", "F3", "critical", "ed", surge=True))
    rooms.append(_one("ER-T2", "ed", "F3", "warning", "ed", surge=True, nurse_index=1))
    rooms += _tile("ER", 1, 4, 3, "ed", "F3", ED, "ed", surge=True)
    rooms += _tile("MS", 301, 8, 2, "med", "F3", MIX, "med")
    rooms += _tile("MED", 201, 12, 1, "med", "F2", MIX, "med")
    rooms += _tile("MED", 213, 12, 1, "med", "F2", list(reversed(MIX)), "med")
    rooms.append(_one("ED-T1", "ed", "F1", "critical", "ed", surge=True))
    rooms.append(_one("ED-T2", "ed", "F1", "warning", "ed", surge=True, nurse_index=1))
    rooms += _tile("ED", 1, 6, 2, "ed", "F1", ED, "ed", surge=True)
    rooms += _tile("FAST", 1, 5, 2, "ed", "F1", MIX, "ed", surge=True)
    rooms += _tile("OBS", 1, 4, 2, "ed", "F1", MIX, "ed", surge=True)

    cursor = 0
    for spec in rooms:
        spec["patient"] = None
        spec["physician"] = None
        spec["nurse"] = None
        spec["needs_or"] = False
        if spec["status"] not in OCCUPIED:
            continue
        spec["patient"] = PATIENTS[cursor]
        cursor += 1
        spec["physician"], spec["nurse"] = crew(spec["team"], spec["nurse_index"])
        if spec["kind"] == "or":
            spec["needs_or"] = True
        elif spec["floor_id"] == "F2" and spec["status"] != "critical" and spec["id"].endswith(("1", "5", "9")):
            spec["needs_or"] = True
    return rooms
