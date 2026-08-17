import asyncio
import json
import logging

import firebase_admin
from firebase_admin import credentials, messaging

from app.config import get_settings

logger = logging.getLogger(__name__)

_app: firebase_admin.App | None = None
_init_attempted = False


def _get_app() -> firebase_admin.App | None:
    """Lazily initializes the Firebase Admin app from
    FIREBASE_SERVICE_ACCOUNT_JSON. Returns None (logging once) if that's
    not configured, rather than raising -- until a real Firebase project
    exists, every caller of send_push() below should silently no-op."""
    global _app, _init_attempted
    if _init_attempted:
        return _app
    _init_attempted = True

    settings = get_settings()
    if not settings.firebase_service_account_json:
        logger.warning("FIREBASE_SERVICE_ACCOUNT_JSON not set -- push notifications are disabled")
        return None

    cred = credentials.Certificate(json.loads(settings.firebase_service_account_json))
    _app = firebase_admin.initialize_app(cred)
    return _app


def _send_sync(tokens: list[str], title: str, body: str) -> None:
    app = _get_app()
    if app is None:
        return
    try:
        messaging.send_each_for_multicast(
            messaging.MulticastMessage(
                notification=messaging.Notification(title=title, body=body),
                tokens=tokens,
            ),
            app=app,
        )
    except Exception:
        logger.exception("Push notification delivery failed")


async def send_push(tokens: list[str], title: str, body: str) -> None:
    """Best-effort push to a set of device tokens -- never raises. Meant
    to be scheduled with FastAPI's BackgroundTasks *after* the caller's
    own commit, so a Firebase outage, an unconfigured project, or a stale
    token can never fail or roll back the change (order status update,
    stock movement, ...) that triggered it."""
    if not tokens:
        return
    try:
        await asyncio.to_thread(_send_sync, tokens, title, body)
    except Exception:
        logger.exception("Push notification delivery failed")
