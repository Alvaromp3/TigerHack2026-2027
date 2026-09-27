"""Tiger Memorial as a building: what is on each floor and the equipment it has.

Mirrors the live map's floor plan (frontend floors.js). Beds, their status and who is in them
come from the census; this is the part of the hospital that does not move.
"""

FLOORS = (
    ("F5", "Clinics and administration", (
        "Outpatient exam rooms", "Clinic waiting", "Medical director", "Conference and board rooms", "Open office",
    )),
    ("F4", "Surgical ward", (
        "Surgical ward beds", "Post-anesthesia recovery (PACU)", "Nurse station", "Family waiting", "Storage",
    )),
    ("F3", "Acute care", (
        "Intensive care unit", "2 operating rooms with scrub and sterile core", "CT suite", "MRI suite",
        "Main pharmacy", "Emergency annex beds", "Medical/surgical beds", "Equipment room", "Staff lounge",
    )),
    ("F2", "Medicine", (
        "Medicine ward beds", "Nurse station", "Floor pharmacy", "Medication room", "Physical therapy gym",
        "Clean and soiled utility", "Family waiting",
    )),
    ("F1", "Emergency", (
        "Emergency department: exam bays, trauma bays, fast track, observation", "Ambulance bay", "Triage",
        "Registration", "Resuscitation support", "CT suite", "X-ray", "Stat lab", "Waiting room",
    )),
    ("B1", "Support services", (
        "Decontamination", "Sterile processing (prep and pack, sterile storage)", "Linen", "General stores",
        "Loading dock", "Mechanical plant", "Body holding",
    )),
)

EQUIPMENT = {
    "CT scanners": "2 (F1 emergency, F3 acute care)",
    "MRI": "1 (F3)",
    "X-ray rooms": "1 (F1)",
    "Operating rooms": "2 (F3)",
    "Cath lab": "none; STEMI goes to Heart Center",
    "Elevators": "3 (A, B and service), serving every floor",
    "Stairs": "2 per floor",
    "Ambulance bay": "1 (F1)",
}
