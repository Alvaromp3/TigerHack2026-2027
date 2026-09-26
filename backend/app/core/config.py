from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Health Hackathon API"
    debug: bool = True
    cors_origins: list[str] = [
        "http://localhost:5173",
    ]
    auth0_domain: str = ""
    auth0_client_id: str = ""
    auth0_client_secret: str = ""
    database_url: str = "postgresql+psycopg://tigerhack:tigerhack@localhost:5433/tigerhack"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors(cls, value):
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


settings = Settings()
