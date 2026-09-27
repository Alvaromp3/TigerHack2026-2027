from fastapi import APIRouter

from app.infra import VERSION

router = APIRouter()


@router.get("/", include_in_schema=False)
def read_root():
    return {
        "service": "SurgeCommand Hospital Operations API",
        "version": VERSION,
        "hospital": "Tiger Memorial Hospital",
        "docs": "/docs",
        "health": "/api/health",
        "fhir": "/fhir/metadata",
        "events": "/api/platform/events",
    }
