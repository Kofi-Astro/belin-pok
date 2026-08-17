"""Thin wrapper around the Supabase Auth Admin REST API.

Used only for staff invitations, which need to create/invite a Supabase
Auth user -- something only the secret (service-role-equivalent) key can
do. Everything else in this app talks to Postgres directly via SQLAlchemy;
this is the one place the secret key gets used.
"""

import httpx

from app.config import get_settings


class SupabaseAdminError(RuntimeError):
    pass


async def invite_user_by_email(email: str) -> dict:
    settings = get_settings()
    if not settings.supabase_secret_key:
        raise SupabaseAdminError("SUPABASE_SECRET_KEY is not configured")

    async with httpx.AsyncClient(base_url=settings.supabase_url, timeout=10) as client:
        response = await client.post(
            "/auth/v1/invite",
            params={"redirect_to": settings.admin_app_url},
            json={"email": email},
            headers={
                "apikey": settings.supabase_secret_key,
                "Authorization": f"Bearer {settings.supabase_secret_key}",
            },
        )
    if response.status_code >= 400:
        raise SupabaseAdminError(f"Supabase invite failed ({response.status_code}): {response.text}")
    return response.json()
