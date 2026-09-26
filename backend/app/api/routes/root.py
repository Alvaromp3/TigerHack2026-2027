from fastapi import APIRouter

router = APIRouter()


@router.get("/")
def read_root():
    return {
        "message": "Health Hackathon API",
        "docs": "/docs",
        "health": "/api/health",
    }
