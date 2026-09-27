"""FHIR R4 views of the live census: Location, Encounter, Patient, Observation.

Data is synthetic (simulated patients), so every Patient carries the HL7 HTEST tag.
"""

from datetime import datetime, timedelta, timezone

from app.infra.events import iso
from app.infra.hl7 import BED_STATUS, mrn, patient_class
from app.sim import TICK_SECONDS

FHIR_VERSION = "4.0.1"
MEDIA_TYPE = "application/fhir+json"
ORGANIZATION = {"reference": "Organization/tiger-memorial", "display": "Tiger Memorial Hospital"}

V2_0116 = "http://terminology.hl7.org/CodeSystem/v2-0116"
PHYSICAL_TYPE = "http://terminology.hl7.org/CodeSystem/location-physical-type"
ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode"
ACT_PRIORITY = "http://terminology.hl7.org/CodeSystem/v3-ActPriority"
PARTICIPATION = "http://terminology.hl7.org/CodeSystem/v3-ParticipationType"
OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category"
LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"

OCCUPIED = {"critical", "warning", "normal"}
DEPT_LABELS = {
    "ed": "Emergency / Trauma",
    "trauma": "Emergency / Trauma",
    "icu": "Intensive Care",
    "med": "Medical / Surgical",
    "surgward": "Surgical ward",
    "surgery": "Surgery (OR)",
}
FLOOR_NAMES = {"F1": "Emergency", "F2": "Medicine", "F3": "Acute care", "F4": "Surgical ward"}


def bed_status(status: str | None) -> tuple[str, str]:
    """HL7 table 0116 code for a room status."""
    if status in OCCUPIED:
        return "O", BED_STATUS["O"]
    if status == "available":
        return "U", BED_STATUS["U"]
    if status == "cleaning":
        return "H", BED_STATUS["H"]
    if status == "reserved":
        return "C", "Closed (held for a patient)"
    return "C", BED_STATUS["C"]


def floor_location(floor_id: str) -> dict:
    return {
        "resourceType": "Location",
        "id": floor_id,
        "identifier": [{"system": "urn:tigermemorial:location", "value": floor_id}],
        "status": "active",
        "name": f"{floor_id} · {FLOOR_NAMES.get(floor_id, floor_id)}",
        "mode": "instance",
        "physicalType": {"coding": [{"system": PHYSICAL_TYPE, "code": "lvl", "display": "Level"}]},
        "managingOrganization": ORGANIZATION,
    }


def bed_location(room) -> dict:
    code, display = bed_status(room.status)
    physical = ("ro", "Room") if room.kind == "or" else ("bd", "Bed")
    return {
        "resourceType": "Location",
        "id": room.id,
        "identifier": [{"system": "urn:tigermemorial:location", "value": room.id}],
        "status": "suspended" if room.status == "blocked" else "active",
        "operationalStatus": {"system": V2_0116, "code": code, "display": display},
        "name": room.id,
        "description": f"{DEPT_LABELS.get(room.dept, room.dept)} · {FLOOR_NAMES.get(room.floor_id, room.floor_id)}",
        "mode": "instance",
        "type": [{"text": DEPT_LABELS.get(room.dept, room.dept)}],
        "physicalType": {"coding": [{"system": PHYSICAL_TYPE, "code": physical[0], "display": physical[1]}]},
        "partOf": {"reference": f"Location/{room.floor_id}", "display": FLOOR_NAMES.get(room.floor_id, room.floor_id)},
        "managingOrganization": ORGANIZATION,
    }


def _priority(acuity: str | None) -> dict:
    code, display = {"critical": ("EM", "emergency"), "warning": ("UR", "urgent")}.get(acuity or "", ("R", "routine"))
    return {"coding": [{"system": ACT_PRIORITY, "code": code, "display": display}]}


def _encounter_class(room_id: str, dept: str | None) -> dict:
    if patient_class(room_id, dept) == "E":
        return {"system": ACT_CODE, "code": "EMER", "display": "emergency"}
    return {"system": ACT_CODE, "code": "IMP", "display": "inpatient encounter"}


def encounter(room, patient, now: datetime) -> dict:
    started = now - timedelta(seconds=(patient.stay_ticks or 0) * TICK_SECONDS)
    resource = {
        "resourceType": "Encounter",
        "id": f"enc-{patient.id}",
        "status": "in-progress",
        "class": _encounter_class(room.id, room.dept),
        "priority": _priority(patient.acuity),
        "subject": {"reference": f"Patient/{mrn(patient.name)}", "display": patient.name},
        "participant": [],
        "period": {"start": iso(started)},
        "location": [{"location": {"reference": f"Location/{room.id}", "display": room.id}, "status": "active"}],
        "serviceProvider": ORGANIZATION,
    }
    if patient.physician:
        resource["participant"].append({
            "type": [{"coding": [{"system": PARTICIPATION, "code": "ATND", "display": "attender"}]}],
            "individual": {"display": patient.physician},
        })
    if patient.nurse:
        resource["participant"].append({
            "type": [{"coding": [{"system": PARTICIPATION, "code": "PPRF", "display": "primary performer"}]}],
            "individual": {"display": patient.nurse},
        })
    if patient.chief_complaint:
        resource["reasonCode"] = [{"text": patient.chief_complaint}]
    if patient.diagnosis:
        resource["diagnosis"] = [{"condition": {"display": patient.diagnosis}, "rank": 1}]
    return resource


def finished_encounter(sequence: int, patient_name: str, room_id: str | None, dept: str | None, ended: datetime | None, destination: str | None) -> dict:
    """Snapshot of an encounter that ended (discharge or transfer out), rebuilt from the event."""
    resource = {
        "resourceType": "Encounter",
        "id": f"enc-evt-{sequence}",
        "status": "finished",
        "class": _encounter_class(room_id or "", dept),
        "subject": {"reference": f"Patient/{mrn(patient_name)}", "display": patient_name},
        "period": {"end": iso(ended)},
        "serviceProvider": ORGANIZATION,
    }
    if room_id:
        resource["location"] = [{"location": {"reference": f"Location/{room_id}", "display": room_id}, "status": "completed"}]
    if destination:
        resource["hospitalization"] = {"destination": {"display": destination}}
    return resource


def patient_resource(name: str) -> dict:
    parts = name.split()
    return {
        "resourceType": "Patient",
        "id": mrn(name),
        "meta": {
            "tag": [{
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActReason",
                "code": "HTEST",
                "display": "test health data",
            }],
        },
        "identifier": [{"system": "urn:tigermemorial:mrn", "value": mrn(name)}],
        "active": True,
        "name": [{"use": "official", "family": parts[-1] if parts else name, "given": parts[:-1]}],
        "managingOrganization": ORGANIZATION,
    }


def _vital(patient, code: str, display: str, now: datetime) -> dict:
    subject = mrn(patient.name)
    return {
        "resourceType": "Observation",
        "id": f"{subject}-{code}",
        "status": "final",
        "category": [{"coding": [{"system": OBS_CATEGORY, "code": "vital-signs", "display": "Vital Signs"}]}],
        "code": {"coding": [{"system": LOINC, "code": code, "display": display}], "text": display},
        "subject": {"reference": f"Patient/{subject}", "display": patient.name},
        "encounter": {"reference": f"Encounter/enc-{patient.id}"},
        "effectiveDateTime": iso(now),
    }


def _quantity(value, unit: str, code: str) -> dict:
    return {"value": value, "unit": unit, "system": UCUM, "code": code}


def vital_signs(patient, now: datetime) -> list[dict]:
    rows = []
    if patient.heart_rate is not None:
        row = _vital(patient, "8867-4", "Heart rate", now)
        row["valueQuantity"] = _quantity(patient.heart_rate, "beats/minute", "/min")
        rows.append(row)
    if patient.systolic is not None and patient.diastolic is not None:
        row = _vital(patient, "85354-9", "Blood pressure panel", now)
        row["component"] = [
            {
                "code": {"coding": [{"system": LOINC, "code": "8480-6", "display": "Systolic blood pressure"}]},
                "valueQuantity": _quantity(patient.systolic, "mmHg", "mm[Hg]"),
            },
            {
                "code": {"coding": [{"system": LOINC, "code": "8462-4", "display": "Diastolic blood pressure"}]},
                "valueQuantity": _quantity(patient.diastolic, "mmHg", "mm[Hg]"),
            },
        ]
        rows.append(row)
    if patient.spo2 is not None:
        row = _vital(patient, "59408-5", "Oxygen saturation by pulse oximetry", now)
        row["valueQuantity"] = _quantity(patient.spo2, "%", "%")
        rows.append(row)
    if patient.respiratory_rate is not None:
        row = _vital(patient, "9279-1", "Respiratory rate", now)
        row["valueQuantity"] = _quantity(patient.respiratory_rate, "breaths/minute", "/min")
        rows.append(row)
    if patient.temperature is not None:
        row = _vital(patient, "8310-5", "Body temperature", now)
        row["valueQuantity"] = _quantity(round(patient.temperature / 10, 1), "C", "Cel")
        rows.append(row)
    return rows


def bundle(resources: list[dict], base: str, self_url: str, total: int | None = None) -> dict:
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "timestamp": iso(datetime.now(timezone.utc)),
        "total": len(resources) if total is None else total,
        "link": [{"relation": "self", "url": self_url}],
        "entry": [
            {
                "fullUrl": f"{base}/{resource['resourceType']}/{resource['id']}",
                "resource": resource,
                "search": {"mode": "match"},
            }
            for resource in resources
        ],
    }


def outcome(code: str, diagnostics: str) -> dict:
    return {
        "resourceType": "OperationOutcome",
        "issue": [{"severity": "error", "code": code, "diagnostics": diagnostics}],
    }


def capability_statement(base: str, software_version: str) -> dict:
    def search(*names):
        return [{"name": name, "type": "token" if name != "partof" else "reference"} for name in names]

    return {
        "resourceType": "CapabilityStatement",
        "id": "rightdoor",
        "status": "active",
        "date": iso(datetime.now(timezone.utc)),
        "publisher": "RightDoor",
        "kind": "instance",
        "software": {"name": "RightDoor Hospital Operations API", "version": software_version},
        "implementation": {"description": "Tiger Memorial Hospital live census (synthetic data)", "url": base},
        "fhirVersion": FHIR_VERSION,
        "format": ["json"],
        "rest": [{
            "mode": "server",
            "resource": [
                {
                    "type": "Location",
                    "interaction": [{"code": "read"}, {"code": "search-type"}],
                    "searchParam": search("operational-status", "partof", "status"),
                },
                {
                    "type": "Encounter",
                    "interaction": [{"code": "read"}, {"code": "search-type"}],
                    "searchParam": search("status", "location", "subject"),
                },
                {"type": "Patient", "interaction": [{"code": "read"}]},
                {
                    "type": "Observation",
                    "interaction": [{"code": "search-type"}],
                    "searchParam": search("patient", "category"),
                },
            ],
        }],
    }
