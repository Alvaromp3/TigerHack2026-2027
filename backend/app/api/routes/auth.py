from fastapi import APIRouter, HTTPException

from app.core.config import settings

router = APIRouter()


@router.get("/config")
def auth_config():
    """Public Auth0 settings for the SPA. Never exposes the client secret."""
    if not settings.auth0_domain or not settings.auth0_client_id:
        raise HTTPException(
            status_code=503,
            detail="Auth0 is not configured. Set AUTH0_DOMAIN and AUTH0_CLIENT_ID in backend/.env",
        )
    return {
        "domain": settings.auth0_domain,
        "clientId": settings.auth0_client_id,
        "audience": None,
    }
