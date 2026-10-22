"""Transactional email (staff invites, password resets) via Resend's HTTP
API -- https://resend.com/docs/api-reference/emails/send-email.

HTTP rather than SMTP on purpose: it's one POST with an API key, and it
doesn't depend on the host allowing outbound SMTP ports.

Best-effort, like app/push.py: with no RESEND_API_KEY configured (local
dev, tests, or before the sending domain is verified), send_email() logs
what it would have sent and returns False instead of raising. Callers
never fail a request just because an email couldn't go out -- an invite
link is also returned to the owner directly (see app/routers/staff.py),
and a reset can simply be requested again.
"""

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_RESEND_URL = "https://api.resend.com/emails"


async def send_email(to: str, subject: str, text: str) -> bool:
    """Sends a plain-text email. Returns whether it was actually handed to
    Resend -- False if email isn't configured or Resend rejected it."""
    settings = get_settings()
    if not settings.resend_api_key:
        # Logged at INFO (not just DEBUG) so a developer running locally can
        # still click through an invite/reset flow from the server logs.
        logger.info("Email not configured; would have sent to %s: %s\n%s", to, subject, text)
        return False

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                _RESEND_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={"from": settings.email_from, "to": [to], "subject": subject, "text": text},
            )
    except httpx.HTTPError:
        logger.exception("Sending email to %s failed", to)
        return False

    if response.status_code >= 400:
        # Most commonly: the sending domain in EMAIL_FROM isn't verified in
        # Resend yet. Logged, not raised -- see the module docstring.
        logger.error("Resend rejected email to %s (%s): %s", to, response.status_code, response.text)
        return False
    return True
