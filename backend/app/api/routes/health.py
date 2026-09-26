from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health_check():
    """Simple health check — replace / extend with your feature endpoints."""
    return {
        "status": "ok",
        "theme": "health",
        "message": "Backend ready. Add your hackathon idea here.",
    }
