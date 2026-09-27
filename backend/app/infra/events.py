"""Canonical hospital events.

Every row in flow_events already is the hospital's event log. This module gives each row a
stable event type, the system that produced it, its HL7 v2 trigger, and a CloudEvents 1.0
envelope, so the same fact can be pushed to webhooks, rendered as HL7 or served as FHIR.
"""

from datetime import datetime, timezone

from app.catalog import DESTINATIONS
from app.sim import OUTSIDE_HOSPITAL

TYPE_PREFIX = "org.tigermemorial."
SOURCE_PREFIX = "/tigermemorial/"

# Names the simulator uses for itself rather than for a patient.
INTERNAL_NAMES = {"Command", "Housekeeping", "Linen"}
PARTNERS = (OUTSIDE_HOSPITAL, *dict.fromkeys(DESTINATIONS.values()))

# Every system a real hospital would plug into this layer. "emulated" systems are driven by the
# simulation engine today; "live" ones are real; "available" ones have a connector but no feed.
SYSTEMS = (
    {
        "id": "ehr-adt",
        "name": "EHR · ADT feed",
        "category": "Clinical",
        "protocol": "HL7 v2.5.1 · MLLP",
        "direction": "inbound",
        "mode": "emulated",
        "color": "#60a5fa",
        "description": "Admissions, transfers and discharges from the electronic health record.",
    },
    {
        "id": "evs",
        "name": "Environmental services",
        "category": "Operations",
        "protocol": "REST · webhooks",
        "direction": "bidirectional",
        "mode": "emulated",
        "color": "#a78bfa",
        "description": "Housekeeping assignments and clean completion for every bed.",
    },
    {
        "id": "linen",
        "name": "Linen & materials",
        "category": "Operations",
        "protocol": "REST",
        "direction": "inbound",
        "mode": "emulated",
        "color": "#f0abfc",
        "description": "Soiled pickup, laundry and clean linen delivery to each bed.",
    },
    {
        "id": "workforce",
        "name": "Workforce & on-call",
        "category": "People",
        "protocol": "SCIM 2.0 · REST",
        "direction": "bidirectional",
        "mode": "emulated",
        "color": "#fbbf24",
        "description": "Rosters, shifts and on-call physician callbacks.",
    },
    {
        "id": "transfer-center",
        "name": "Regional transfer center",
        "category": "Network",
        "protocol": "FHIR R4",
        "direction": "outbound",
        "mode": "emulated",
        "color": "#fb923c",
        "description": "Outbound transfers to partner hospitals in the region.",
    },
    {
        "id": "facilities",
        "name": "Facilities & maintenance",
        "category": "Operations",
        "protocol": "REST",
        "direction": "bidirectional",
        "mode": "live",
        "color": "#94a3b8",
        "description": "Beds taken out of service by an incident and returned after repair.",
    },
    {
        "id": "command-center",
        "name": "SurgeCommand console",
        "category": "Capacity",
        "protocol": "REST API",
        "direction": "bidirectional",
        "mode": "live",
        "color": "#34d399",
        "description": "Bed holds and decisions made by staff in this console.",
    },
    {
        "id": "identity",
        "name": "Identity & SSO",
        "category": "Security",
        "protocol": "OpenID Connect",
        "direction": "inbound",
        "mode": "live",
        "color": "#e2e8f0",
        "description": "Staff sign-in through Auth0.",
    },
    {
        "id": "ops-ai",
        "name": "Operations AI",
        "category": "Intelligence",
        "protocol": "REST · Gemini",
        "direction": "outbound",
        "mode": "live",
        "color": "#5eead4",
        "description": "Briefings and answers generated from the live census.",
    },
    {
        "id": "nurse-call",
        "name": "Nurse call & RTLS",
        "category": "Clinical",
        "protocol": "HL7 v2 · vendor API",
        "direction": "inbound",
        "mode": "available",
        "color": "#64748b",
        "description": "Call lights and real-time staff location. Connector ready, no feed yet.",
    },
    {
        "id": "lis",
        "name": "Laboratory (LIS)",
        "category": "Clinical",
        "protocol": "HL7 v2 · ORU^R01",
        "direction": "inbound",
        "mode": "available",
        "color": "#64748b",
        "description": "Lab results that gate discharges. Connector ready, no feed yet.",
    },
    {
        "id": "pharmacy",
        "name": "Pharmacy",
        "category": "Clinical",
        "protocol": "HL7 v2 · RDE^O11",
        "direction": "inbound",
        "mode": "available",
        "color": "#64748b",
        "description": "Medication orders and discharge prescriptions. Connector ready, no feed yet.",
    },
)
SYSTEM_BY_ID = {system["id"]: system for system in SYSTEMS}

EVENT_TYPES = (
    ("patient.admitted", "Patient admitted to a bed"),
    ("patient.transferred", "Patient moved to another bed or to the OR"),
    ("patient.discharged", "Patient left the hospital"),
    ("patient.transferred_out", "Patient sent to a partner hospital"),
    ("bed.available", "Bed cleaned, linen in place, open for the next admission"),
    ("bed.reserved", "Bed held for a named patient"),
    ("bed.released", "Bed hold released"),
    ("bed.out_of_service", "Bed blocked by an incident"),
    ("bed.returned_to_service", "Bed back in service after an incident"),
    ("evs.clean_assigned", "Housekeeper assigned to a bed"),
    ("linen.delivered", "Clean linen delivered to a bed"),
    ("staff.called_in", "On-call physicians brought on duty"),
    ("transfer.batch", "Group transfer to a partner hospital"),
    ("transfer.incoming_notice", "Incoming patients announced"),
    ("platform.test", "Test event sent from the platform"),
)
EVENT_TYPE_NAMES = {name for name, _ in EVENT_TYPES}


def _event(type_, system, patient, hl7=None, bed_status=None, disposition=None):
    return {
        "type": type_,
        "system": system,
        "patient": patient,
        "hl7": hl7,
        "bed_status": bed_status,
        "disposition": disposition,
    }


def classify(name: str | None, message: str | None, kind: str | None, room_id: str | None) -> dict:
    """Map one flow_events row to its canonical type. Mirrors the _log calls in sim.py."""
    text = message or ""
    person = None if (name or "") in INTERNAL_NAMES else name

    if kind == "admit":
        if name == "Command":
            return _event("transfer.incoming_notice", "transfer-center", None)
        return _event("patient.admitted", "ehr-adt", person, "A01")
    if kind == "discharge":
        return _event("patient.discharged", "ehr-adt", person, "A03", disposition="01")
    if kind == "death":
        # HL7 v2 discharge disposition 20: expired.
        return _event("patient.discharged", "ehr-adt", person, "A03", disposition="20")
    if kind in ("divert", "transfer"):
        if name == "Command" or not room_id:
            return _event("transfer.batch", "transfer-center", None)
        # Disposition 02: discharged to another short-term general hospital.
        return _event("patient.transferred_out", "transfer-center", person, "A03", disposition="02")
    if kind == "clean":
        if " assigned to " in text:
            return _event("evs.clean_assigned", "evs", None, "A20", bed_status="H")
        if "linen delivered" in text:
            return _event("linen.delivered", "linen", None)
        if " is open" in text:
            return _event("bed.available", "evs", None, "A20", bed_status="U")
        return _event("hospital.event", "evs", None)

    if " reserved for " in text:
        return _event("bed.reserved", "command-center", text.split(" reserved for ", 1)[1].strip(), "A20", bed_status="C")
    if " is waiting on " in text:
        return _event("bed.reserved", "command-center", person, "A20", bed_status="C")
    if " hold released" in text:
        return _event("bed.released", "command-center", None, "A20", bed_status="U")
    if " blocked — " in text:
        return _event("bed.out_of_service", "facilities", None, "A20", bed_status="C")
    if " incident closed" in text:
        return _event("bed.returned_to_service", "facilities", None, "A20", bed_status="U")
    if text.startswith("Called in"):
        return _event("staff.called_in", "workforce", None)
    if kind in ("move", "or") and person:
        return _event("patient.transferred", "ehr-adt", person, "A02")
    return _event("hospital.event", "command-center", person)


def destination(message: str | None) -> str | None:
    text = message or ""
    return next((partner for partner in PARTNERS if partner in text), None)


def iso(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def event_id(sequence: int) -> str:
    return f"evt_{sequence:08d}"


def event_row(row, info: dict | None = None) -> dict:
    """Flat view of one event for the console and the event stream."""
    info = info or classify(row.patient_name, row.message, row.kind, row.room_id)
    system = SYSTEM_BY_ID.get(info["system"], SYSTEM_BY_ID["command-center"])
    return {
        "id": row.id,
        "event_id": event_id(row.id),
        "type": info["type"],
        "system": system["id"],
        "system_name": system["name"],
        "color": system["color"],
        "room_id": row.room_id,
        "patient": info["patient"],
        "message": row.message,
        "hl7": f"ADT^{info['hl7']}" if info["hl7"] else None,
        "bed_status": info["bed_status"],
        "time": iso(row.created_at),
    }


def cloud_event(row, info: dict | None = None) -> dict:
    """CloudEvents 1.0 structured-mode envelope for one hospital event."""
    info = info or classify(row.patient_name, row.message, row.kind, row.room_id)
    data = {
        "sequence": row.id,
        "message": row.message,
        "room_id": row.room_id,
        "patient": info["patient"],
        "hl7_trigger": f"ADT^{info['hl7']}" if info["hl7"] else None,
        "bed_status": info["bed_status"],
    }
    if info["disposition"]:
        data["discharge_disposition"] = info["disposition"]
    partner = destination(row.message)
    if partner:
        data["destination"] = partner
    return {
        "specversion": "1.0",
        "id": event_id(row.id),
        "source": SOURCE_PREFIX + info["system"],
        "type": TYPE_PREFIX + info["type"],
        "time": iso(row.created_at),
        "subject": f"Location/{row.room_id}" if row.room_id else None,
        "datacontenttype": "application/json",
        "data": data,
    }


def test_event(stamp: datetime, subscription_id: int) -> dict:
    return {
        "specversion": "1.0",
        "id": f"evt_test_{int(stamp.timestamp())}",
        "source": SOURCE_PREFIX + "platform",
        "type": TYPE_PREFIX + "platform.test",
        "time": iso(stamp),
        "subject": f"WebhookSubscription/{subscription_id}",
        "datacontenttype": "application/json",
        "data": {"message": "Test event from the SurgeCommand platform."},
    }
