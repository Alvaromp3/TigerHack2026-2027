"""HL7 v2.5.1 ADT messages for hospital events.

This is how an EHR's admission/discharge/transfer feed would carry the same facts over MLLP:
A01 admit, A02 transfer, A03 discharge, and A20 bed status update (NPU segment, table 0116).
"""

import hashlib
from datetime import datetime, timezone

SENDING_APP = "SURGECMD"
FACILITY = "TIGERMEM"
STRUCTURE = {"A01": "ADT_A01", "A02": "ADT_A02", "A03": "ADT_A03", "A20": "ADT_A20"}
POINT_OF_CARE = {"ed": "ED", "trauma": "ED", "icu": "ICU", "med": "MEDSURG", "surgward": "SURG", "surgery": "OR"}
EMERGENCY_ROOMS = ("ED", "ER", "FAST", "OBS")
# HL7 table 0116, bed status.
BED_STATUS = {"O": "Occupied", "U": "Unoccupied", "H": "Housekeeping", "C": "Closed"}


def mrn(name: str) -> str:
    """Stable synthetic medical record number for a simulated patient."""
    digest = hashlib.sha1((name or "").strip().lower().encode("utf-8")).hexdigest()
    return f"TM{int(digest, 16) % 1_000_000:06d}"


def timestamp(moment: datetime | None) -> str:
    moment = moment or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y%m%d%H%M%S")


def escape(value: str | None) -> str:
    """Escape HL7 delimiters inside free text."""
    text = value or ""
    for raw, coded in (("\\", "\\E\\"), ("|", "\\F\\"), ("^", "\\S\\"), ("&", "\\T\\"), ("~", "\\R\\")):
        text = text.replace(raw, coded)
    return text


def person_name(name: str | None) -> str:
    """XPN/XCN name components: family^given."""
    parts = (name or "").replace("Dr. ", "").replace("RN ", "").split()
    if not parts:
        return ""
    return f"{escape(parts[-1])}^{escape(' '.join(parts[:-1]))}"


def location(room_id: str | None, dept: str | None) -> str:
    """PL datatype: point of care ^ room ^ bed ^ facility."""
    if not room_id:
        return ""
    unit = POINT_OF_CARE.get(dept or "") or room_id.split("-")[0]
    return f"{unit}^{escape(room_id)}^A^{FACILITY}"


def patient_class(room_id: str | None, dept: str | None) -> str:
    if dept in ("ed", "trauma") or (room_id or "").startswith(EMERGENCY_ROOMS):
        return "E"
    return "I"


def message(
    sequence: int,
    trigger: str,
    when: datetime | None,
    room_id: str | None,
    dept: str | None = None,
    patient: str | None = None,
    bed_status: str | None = None,
    disposition: str | None = None,
    destination: str | None = None,
    attending: str | None = None,
) -> str:
    """One ADT message. Segments are separated by carriage returns, as the standard requires."""
    stamp = timestamp(when)
    segments = [
        f"MSH|^~\\&|{SENDING_APP}|{FACILITY}|ADT|{FACILITY}|{stamp}||ADT^{trigger}^{STRUCTURE[trigger]}"
        f"|SC{sequence:09d}|P|2.5.1",
        f"EVN|{trigger}|{stamp}",
    ]
    if trigger == "A20":
        segments.append(f"NPU|{location(room_id, dept)}|{bed_status or 'U'}")
        return "\r".join(segments)

    segments.append(f"PID|1||{mrn(patient)}^^^{FACILITY}^MR||{person_name(patient)}")
    pv1 = [""] * 46
    pv1[0] = "PV1"
    pv1[1] = "1"
    pv1[2] = patient_class(room_id, dept)
    pv1[3] = location(room_id, dept)
    if attending:
        pv1[7] = f"^{person_name(attending)}"
    if trigger == "A01":
        pv1[44] = stamp
    if trigger == "A03":
        pv1[36] = disposition or "01"
        if destination:
            pv1[37] = escape(destination)
        pv1[45] = stamp
    segments.append("|".join(pv1).rstrip("|"))
    return "\r".join(segments)
