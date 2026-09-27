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


def fresh_patient_name(taken: set[str], index: int = 0) -> str:
    """Next unused full name. Never appends a number."""
    for step in range(len(PATIENTS)):
        candidate = PATIENTS[(index + step) % len(PATIENTS)]
        if candidate not in taken:
            return candidate
    raise RuntimeError("patient name pool exhausted")

# Several attendings and nurses per unit so a demo census stays near a safe load
# (about 4 patients per nurse, 4–5 per attending) instead of one person covering a whole floor.
CREWS = {
    "icu": (
        ["Dr. Leena Patel", "Dr. Omar Desta"],
        ["RN Maya Chen", "RN Chris Novak", "RN Imani Diaz"],
    ),
    "ed": (
        [
            "Dr. Jonah Okonkwo",
            "Dr. Amina Diallo",
            "Dr. Keisha Ward",
            "Dr. Luis Ortega",
            "Dr. Hannah Berg",
            "Dr. Samuel Cho",
            "Dr. Fatima Okeke",
        ],
        [
            "RN Elena Brooks",
            "RN Jonah Blake",
            "RN Sofia Lang",
            "RN Owen Clarke",
            "RN Ruth Ferreira",
            "RN Malik Santos",
            "RN Chloe Reddy",
            "RN Yara Nguyen",
        ],
    ),
    "med": (
        ["Dr. Amir Shah", "Dr. Elena Voss", "Dr. Andre Nair", "Dr. Mei Ortiz", "Dr. Daniel Ibrahim"],
        ["RN Luis Ibarra", "RN Priya Raman", "RN Felix Haddad", "RN Ines Keller", "RN Ravi Petrov", "RN Amara Cohen"],
    ),
    "surg": (
        ["Dr. Camila Alvarez", "Dr. Paul Kim", "Dr. Nora Abebe", "Dr. Victor Santos"],
        ["RN Grace Walsh", "RN Diego Tanaka", "RN Leah Moreau", "RN Hassan Cole"],
    ),
}

DESTINATIONS = {
    "icu_full": "County Trauma",
    "or_full": "Heart Center",
}

# Deterministic clinical profiles for census patients.
CASES = [
    {"age": 67, "chief_complaint": "Crush injury after train collision", "diagnosis": "Polytrauma, hemorrhagic shock"},
    {"age": 41, "chief_complaint": "Sudden chest pain and diaphoresis", "diagnosis": "STEMI — anterior wall"},
    {"age": 29, "chief_complaint": "Migraine unrelieved at home", "diagnosis": "Status migrainosus"},
    {"age": 58, "chief_complaint": "Shortness of breath, fever", "diagnosis": "Community-acquired pneumonia"},
    {"age": 74, "chief_complaint": "Fall with hip pain, cannot bear weight", "diagnosis": "Right femoral neck fracture"},
    {"age": 33, "chief_complaint": "Twisted ankle after a fall", "diagnosis": "Ankle fracture"},
    {"age": 52, "chief_complaint": "Worsening asthma overnight", "diagnosis": "Acute asthma"},
    {"age": 81, "chief_complaint": "Left-sided weakness", "diagnosis": "Acute ischemic stroke"},
    {"age": 46, "chief_complaint": "Abdominal pain and vomiting", "diagnosis": "Acute appendicitis"},
    {"age": 22, "chief_complaint": "Motorcycle crash, neck pain", "diagnosis": "Cervical spine precaution"},
    {"age": 63, "chief_complaint": "Palpitations and lightheadedness", "diagnosis": "Atrial fibrillation with RVR"},
    {"age": 37, "chief_complaint": "Severe allergic reaction", "diagnosis": "Anaphylaxis — resolved"},
    {"age": 55, "chief_complaint": "Epigastric pain radiating to back", "diagnosis": "Acute pancreatitis"},
    {"age": 19, "chief_complaint": "Seizure at school", "diagnosis": "New-onset seizure"},
    {"age": 70, "chief_complaint": "Altered mental status", "diagnosis": "Sepsis — source unclear"},
    {"age": 44, "chief_complaint": "Gunshot wound to abdomen", "diagnosis": "Penetrating abdominal trauma"},
    {"age": 61, "chief_complaint": "Syncope at home", "diagnosis": "High-grade AV block"},
    {"age": 28, "chief_complaint": "Overdose, decreased responsiveness", "diagnosis": "Opioid overdose — reverse"},
    {"age": 49, "chief_complaint": "Severe headache, worst of life", "diagnosis": "SAH ruled out — migraine"},
    {"age": 36, "chief_complaint": "Cut hand on broken glass", "diagnosis": "Laceration, needs repair"},
    {"age": 77, "chief_complaint": "Confusion and low urine output", "diagnosis": "Urosepsis"},
    {"age": 31, "chief_complaint": "Pregnancy, vaginal bleeding", "diagnosis": "Threatened miscarriage"},
    {"age": 54, "chief_complaint": "Burns to arms and face", "diagnosis": "Partial-thickness burns 12% TBSA"},
    {"age": 42, "chief_complaint": "Diabetic, high sugars, vomiting", "diagnosis": "DKA"},
]


def random_case():
    import random
    return random.choice(CASES)


def clinical_case(name: str, acuity: str, index: int = 0):
    """Pick a stable case for a patient name; critical cases bias toward trauma."""
    seed = sum(ord(ch) for ch in name) + index * 17
    if acuity == "critical":
        pool = [c for c in CASES if "trauma" in c["diagnosis"].lower() or "shock" in c["diagnosis"].lower()
                or "STEMI" in c["diagnosis"] or "stroke" in c["diagnosis"].lower()
                or "Gunshot" in c["chief_complaint"] or "Sepsis" in c["diagnosis"]
                or "anaphylaxis" in c["diagnosis"].lower() or "block" in c["diagnosis"].lower()]
        if not pool:
            pool = CASES
        case = pool[seed % len(pool)]
    else:
        case = CASES[seed % len(CASES)]
    return dict(case)


def crew(team, nurse_index=0):
    physicians, nurses = CREWS[team]
    return physicians[nurse_index % len(physicians)], nurses[nurse_index % len(nurses)]


def balanced_crew(team, physician_counts, nurse_counts):
    """On-duty pair with the smallest current panels."""
    physicians, nurses = CREWS[team]

    def lightest(names, counts):
        return min(names, key=lambda name: (counts.get(name, 0), names.index(name)))

    return lightest(physicians, physician_counts), lightest(nurses, nurse_counts)


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
        spec["physician"], spec["nurse"] = crew(spec["team"], cursor)
        cursor += 1
        case = clinical_case(spec["patient"], spec["status"], cursor)
        spec["age"] = case["age"]
        spec["chief_complaint"] = case["chief_complaint"]
        spec["diagnosis"] = case["diagnosis"]
        if spec["kind"] == "or":
            spec["needs_or"] = True
        elif spec["floor_id"] == "F2" and spec["status"] != "critical" and spec["id"].endswith(("1", "5", "9")):
            spec["needs_or"] = True
    return rooms
