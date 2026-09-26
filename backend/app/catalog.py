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

PATIENTS = [
    "Sofia Alvarez", "James Whitfield", "Noah Bennett", "Amina Diallo", "Helen Cho",
    "Mateo Ruiz", "Grace Ibrahim", "Owen Clarke", "Priya Nair", "Samuel Ortiz",
    "Lila Berg", "Jonah Abebe", "Emma Walsh", "Hugo Ferreira", "Nora Kim",
    "Eliot March", "Clara Voss", "Andre Blake", "Maya Haddad", "Felix Nguyen",
]

ARRIVALS = [
    "Camila Ortiz", "Hassan Ali", "Ruth Mendel", "Diego Park", "Imani Brooks",
    "Lars Holm", "Yara Haddad", "Owen Briggs", "Mei Tanaka", "Paul Okeke",
    "Nina Petrov", "Omar Said", "Leah Cohen", "Victor Lang", "Asha Reddy",
]

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
        spec["patient"] = PATIENTS[cursor % len(PATIENTS)]
        cursor += 1
        spec["physician"], spec["nurse"] = crew(spec["team"], spec["nurse_index"])
        if spec["kind"] == "or":
            spec["needs_or"] = True
        elif spec["floor_id"] == "F2" and spec["status"] != "critical" and spec["id"].endswith(("1", "5", "9")):
            spec["needs_or"] = True
    return rooms
