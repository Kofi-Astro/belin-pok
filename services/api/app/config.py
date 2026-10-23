from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "local"

    database_url: str

    # Signs the API's own access tokens (see app/security.py). Any long
    # random string -- e.g. `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
    # Changing it signs everyone out (their refresh tokens still work, so
    # the apps quietly get a fresh access token on the next request).
    jwt_secret: str
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    cors_origins: str = "http://localhost:5000"

    # The shop's local timezone: where "today", "this week" and each day's
    # tally begin and end in the sales reports. Ghana has no daylight
    # saving and sits on UTC, but reports use this rather than assuming so.
    shop_timezone: str = "Africa/Accra"

    # Where invite and password-reset links send people. Staff links open
    # the admin app's set-password screen; customer reset links open the
    # storefront's.
    admin_app_url: str = "https://admin.belpok.xyz"
    storefront_url: str = "https://belpok.xyz"

    # Optional. Without a Resend API key, invite/reset emails aren't sent
    # (see app/email.py) -- an owner can still copy an invite link from the
    # Staff screen and share it directly.
    resend_api_key: str | None = None
    email_from: str = "Belin-Pok <no-reply@belpok.xyz>"

    # Product photo storage: any S3-compatible bucket (a Railway Bucket in
    # production). Unset locally/in tests, where an in-memory store stands
    # in instead -- see app/storage.py.
    s3_endpoint_url: str | None = None
    s3_bucket: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_region: str = "auto"
    # How object URLs are formed: "virtual" (bucket.endpoint/key) or
    # "path" (endpoint/bucket/key). Railway Buckets require virtual-host
    # style; boto3 would otherwise pick path style for a custom endpoint.
    s3_addressing_style: str = "virtual"

    # Raw JSON of a Firebase service account key (Firebase Console ->
    # Project Settings -> Service Accounts -> Generate new private key).
    # Optional: push notifications are a best-effort feature (see
    # app/push.py) that silently no-ops without it, same as
    # resend_api_key being optional above.
    firebase_service_account_json: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
