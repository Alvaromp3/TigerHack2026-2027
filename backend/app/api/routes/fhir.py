"""FHIR R4 read API over the live census (synthetic data)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.infra import VERSION, fhir
from app.infra.hl7 import mrn
from app.models import Patient, Room

router = APIRouter()

CENSUS_KINDS = ("bed", "or")
STATUS_CODES = {"O", "U", "H", "C"}


def _fhir(payload: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status, media_type=fhir.MEDIA_TYPE)


def _base(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/fhir"


def _not_found(what: str) -> JSONResponse:
    return _fhir(fhir.outcome("not-found", f"{what} was not found."), status=404)


def _census(db: Session):
    return db.scalars(
        select(Room).options(selectinload(Room.patient)).where(Room.kind.in_(CENSUS_KINDS)).order_by(Room.id)
    ).all()


@router.get("/metadata", summary="CapabilityStatement")
def metadata(request: Request):
    return _fhir(fhir.capability_statement(_base(request), VERSION))


@router.get("/Location", summary="Search beds and floors")
def search_locations(
    request: Request,
    operational_status: str | None = Query(None, alias="operational-status", description="HL7 table 0116 code: O, U, H or C"),
    partof: str | None = Query(None, description="Floor, e.g. Location/F1 or F1"),
    count: int = Query(200, alias="_count", ge=1, le=500),
    db: Session = Depends(get_db),
):
    rooms = _census(db)
    if operational_status:
        code = operational_status.split("|")[-1].upper()
        if code not in STATUS_CODES:
            return _fhir(fhir.outcome("value", f"Unknown operational-status {operational_status}."), status=400)
        rooms = [room for room in rooms if fhir.bed_status(room.status)[0] == code]
    if partof:
        floor = partof.removeprefix("Location/")
        rooms = [room for room in rooms if room.floor_id == floor]
    resources = [fhir.bed_location(room) for room in rooms]
    return _fhir(fhir.bundle(resources[:count], _base(request), str(request.url), total=len(resources)))


@router.get("/Location/{location_id}", summary="Read one bed or floor")
def read_location(location_id: str, db: Session = Depends(get_db)):
    room = db.get(Room, location_id)
    if room is not None and room.kind in CENSUS_KINDS:
        return _fhir(fhir.bed_location(room))
    floors = {floor for (floor,) in db.execute(select(Room.floor_id).distinct()).all()}
    if location_id in floors:
        return _fhir(fhir.floor_location(location_id))
    return _not_found(f"Location/{location_id}")


def _encounters(db: Session):
    return [(room, room.patient) for room in _census(db) if room.patient is not None]


@router.get("/Encounter", summary="Search current encounters")
def search_encounters(
    request: Request,
    status: str | None = Query(None, description="in-progress is the only status held in the live census"),
    location: str | None = Query(None, description="Location/ED-04 or ED-04"),
    subject: str | None = Query(None, description="Patient/TM123456 or TM123456"),
    count: int = Query(50, alias="_count", ge=1, le=500),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    pairs = _encounters(db) if status in (None, "in-progress") else []
    if location:
        room_id = location.removeprefix("Location/")
        pairs = [(room, patient) for room, patient in pairs if room.id == room_id]
    if subject:
        patient_id = subject.removeprefix("Patient/")
        pairs = [(room, patient) for room, patient in pairs if mrn(patient.name) == patient_id]
    resources = [fhir.encounter(room, patient, now) for room, patient in pairs]
    return _fhir(fhir.bundle(resources[:count], _base(request), str(request.url), total=len(resources)))


@router.get("/Encounter/{encounter_id}", summary="Read one current encounter")
def read_encounter(encounter_id: str, db: Session = Depends(get_db)):
    try:
        patient_id = int(encounter_id.removeprefix("enc-"))
    except ValueError:
        return _not_found(f"Encounter/{encounter_id}")
    patient = db.get(Patient, patient_id)
    if patient is None or patient.room is None:
        return _not_found(f"Encounter/{encounter_id}")
    return _fhir(fhir.encounter(patient.room, patient, datetime.now(timezone.utc)))


def _patient_by_mrn(db: Session, patient_id: str) -> Patient | None:
    for patient in db.scalars(select(Patient)).all():
        if mrn(patient.name) == patient_id:
            return patient
    return None


@router.get("/Patient/{patient_id}", summary="Read one patient (synthetic)")
def read_patient(patient_id: str, db: Session = Depends(get_db)):
    patient = _patient_by_mrn(db, patient_id)
    if patient is None:
        return _not_found(f"Patient/{patient_id}")
    return _fhir(fhir.patient_resource(patient.name))


@router.get("/Observation", summary="Latest vital signs for a patient")
def search_observations(
    request: Request,
    patient: str = Query(..., description="Patient/TM123456 or TM123456"),
    category: str | None = Query(None, description="vital-signs"),
    db: Session = Depends(get_db),
):
    if category and category.split("|")[-1] != "vital-signs":
        return _fhir(fhir.bundle([], _base(request), str(request.url)))
    found = _patient_by_mrn(db, patient.removeprefix("Patient/"))
    resources = fhir.vital_signs(found, datetime.now(timezone.utc)) if found else []
    return _fhir(fhir.bundle(resources, _base(request), str(request.url)))
