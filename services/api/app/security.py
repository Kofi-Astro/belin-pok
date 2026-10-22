"""Authentication primitives: password hashing, the API's own signed
access tokens, and opaque random tokens (refresh tokens, invite/reset
links) that are stored only as hashes. This only answers "is this a
valid signed-in user, and who are they" -- app/deps.py builds on top of
this to answer "are they staff, or a customer, and what can they do",
and app/routers/auth.py is what actually issues tokens.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings

settings = get_settings()

_bearer_scheme = HTTPBearer(auto_error=False)
_password_hasher = PasswordHasher()

_ACCESS_TOKEN_TYPE = "access"


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """False for a user with no password yet (an invite not yet accepted)
    as well as for a wrong password -- the caller can't tell, and
    shouldn't need to."""
    if password_hash is None:
        # Still spend the hashing time, so "no such password" isn't
        # measurably faster than "wrong password".
        _password_hasher.hash(password)
        return False
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def new_opaque_token() -> tuple[str, str]:
    """A random token to hand out, and the hash to store for it. Only the
    hash ever touches the database (see migrations/*_auth_sessions.sql);
    a plain SHA-256 is enough here because the token itself is 256 bits
    of randomness, not a guessable password."""
    token = secrets.token_urlsafe(32)
    return token, hash_opaque_token(token)


def hash_opaque_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user_id),
            "typ": _ACCESS_TOKEN_TYPE,
            "iat": now,
            "exp": now + timedelta(minutes=settings.access_token_minutes),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """Verifies an access token's signature and expiry and returns its
    claims ("sub" is the users.id). 401 on anything wrong with it -- the
    apps treat that as "refresh, then retry once"."""
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    if claims.get("typ") != _ACCESS_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not an access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return claims


async def get_current_auth_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict[str, Any]:
    """FastAPI dependency for routes that require *some* signed-in user --
    401s if there's no bearer token at all. Doesn't say anything about
    staff vs. customer; see app/deps.py for that."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return decode_access_token(credentials.credentials)


async def get_optional_auth_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict[str, Any] | None:
    """Same as get_current_auth_user, but returns None instead of 401 when
    no bearer token is present. Used by routes reachable both by guests
    and signed-in customers (e.g. checkout), where "no token" is a valid
    request, not an auth failure."""
    if credentials is None:
        return None
    return decode_access_token(credentials.credentials)
