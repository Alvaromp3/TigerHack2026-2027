import json
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Health Hackathon API"
    debug: bool = True
    # NoDecode keeps a plain URL from the environment. Pydantic otherwise
    # tries to JSON-parse list fields and crashes on values like http://localhost:5173.
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
    ]
    auth0_domain: str = ""
    auth0_client_id: str = ""
    auth0_client_secret: str = ""
    database_url: str = "postgresql+psycopg://tigerhack:tigerhack@localhost:5433/tigerhack"
    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-4o-mini"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors(cls, value):
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                parsed = json.loads(text)
                return [str(origin).strip() for origin in parsed if str(origin).strip()]
            return [origin.strip() for origin in text.split(",") if origin.strip()]
        return value


settings = Settings()
