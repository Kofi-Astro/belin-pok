from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "local"

    database_url: str

    supabase_url: str
    supabase_publishable_key: str | None = None
    supabase_secret_key: str | None = None

    cors_origins: str = "http://localhost:5000"

    # Raw JSON of a Firebase service account key (Firebase Console ->
    # Project Settings -> Service Accounts -> Generate new private key).
    # Optional: push notifications are a best-effort feature (see
    # app/push.py) that silently no-ops without it, same as
    # supabase_secret_key being optional above.
    firebase_service_account_json: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
