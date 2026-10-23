"""Signing in and out, for staff and customers alike.

How a session works:

- POST /auth/login (or /auth/signup, or redeeming an invite/reset link)
  returns a TokenPair: a short-lived access token (a signed JWT, see
  app/security.py) that goes on every request as `Authorization: Bearer
  ...`, and a long-lived opaque refresh token.
- When the access token expires, the app trades the refresh token for a
  new pair at POST /auth/refresh. Every refresh *rotates*: the old refresh
  token is revoked and a new one issued, so a refresh token is only ever
  good for one use.
- POST /auth/logout revokes the device's refresh token. Changing a
  password, or an owner deactivating a staff member, revokes all of them
  -- that's what makes those take effect within one access-token
  lifetime (15 minutes by default) rather than whenever a token expires.

Who someone is (staff role, customer profile) is deliberately not part of
any of this -- app/deps.py resolves that per request from the user id in
the access token, exactly as it did with Supabase.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.email import send_email
from app.models import (
    Customer,
    CustomerStatus,
    CustomerType,
    FailedLogin,
    OneTimeToken,
    OneTimeTokenPurpose,
    RefreshToken,
    Staff,
    User,
)
from app.phone import normalize_phone
from app.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    SetPasswordWithTokenRequest,
    SignupRequest,
    TokenPair,
)
from app.security import (
    create_access_token,
    get_current_auth_user,
    hash_opaque_token,
    hash_password,
    new_opaque_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

settings = get_settings()

# Password-guessing throttle: after this many wrong passwords for one
# username/email within the window, further attempts are refused (even
# correct ones) until older failures age out. Generous enough that a
# person mistyping never hits it; tight enough that guessing is useless.
_MAX_FAILED_LOGINS = 10
_FAILED_LOGIN_WINDOW = timedelta(minutes=15)

# An invite has to survive "I'll do it tomorrow"; a reset link is only
# needed for the next few minutes and is more dangerous if an old email
# is found later.
_INVITE_LIFETIME = timedelta(days=7)
_RESET_LIFETIME = timedelta(hours=1)

# Same message for "no such account" and "wrong password", so sign-in
# can't be used to discover which usernames/emails exist.
_BAD_CREDENTIALS = "Incorrect username/email or password"


# ---------- helpers shared with app/routers/staff.py and app/cli.py ----------


async def issue_tokens(db: AsyncSession, user: User) -> TokenPair:
    """Starts a new session for this user: adds a RefreshToken row (the
    caller commits) and returns the pair to hand back to the app."""
    refresh_token, refresh_hash = new_opaque_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
        )
    )
    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=refresh_token,
        expires_in=settings.access_token_minutes * 60,
        must_change_password=user.must_change_password,
    )


async def revoke_all_sessions(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Signs this user out everywhere (the caller commits). Already-issued
    access tokens still work until they expire -- at most
    ACCESS_TOKEN_MINUTES -- since checking a revocation list on every
    request is exactly the cost short-lived access tokens exist to avoid.
    Deactivated staff are cut off immediately anyway, by get_current_staff
    checking is_active on every request."""
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


async def create_one_time_link(db: AsyncSession, user: User, purpose: OneTimeTokenPurpose) -> str:
    """Creates an invite/reset token (the caller commits) and returns the
    full link to send. Staff links open the admin app; anyone else's open
    the storefront -- both have a screen that reads ?token= and calls
    POST /auth/set-password."""
    token, token_hash = new_opaque_token()
    lifetime = _INVITE_LIFETIME if purpose == OneTimeTokenPurpose.invite else _RESET_LIFETIME
    db.add(
        OneTimeToken(
            user_id=user.id,
            purpose=purpose.value,
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + lifetime,
        )
    )
    is_staff = await db.get(Staff, user.id) is not None
    base = settings.admin_app_url if is_staff else settings.storefront_url
    path = "set-password" if is_staff else "reset-password"
    # Plain paths: both web apps (apps/web, apps/admin-web) use real URLs,
    # and their hosts serve the app for any path. Opened on a phone with
    # the Flutter app installed, the link still lands on the web
    # storefront -- which is fine; resetting a password is a one-off.
    return f"{base.rstrip('/')}/{path}?token={token}"


async def _ensure_may_sign_in(db: AsyncSession, user: User) -> None:
    """A deactivated staff member can't start (or refresh) a session.
    Checked here as well as in get_current_staff, so they're told why at
    the sign-in screen instead of signing in to a wall of 403s."""
    staff = await db.get(Staff, user.id)
    if staff is not None and not staff.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated")


async def _user_from_claims(db: AsyncSession, claims: dict[str, Any]) -> User:
    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account no longer exists")
    return user


async def _check_not_throttled(db: AsyncSession, identifier: str) -> None:
    since = datetime.now(UTC) - _FAILED_LOGIN_WINDOW
    recent_failures = await db.scalar(
        select(func.count())
        .select_from(FailedLogin)
        .where(FailedLogin.identifier == identifier, FailedLogin.created_at > since)
    )
    if recent_failures >= _MAX_FAILED_LOGINS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts — wait 15 minutes and try again",
        )


# ---------- endpoints ----------


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    identifier = payload.identifier.strip()
    await _check_not_throttled(db, identifier)

    # username and email are both citext, so this match is
    # case-insensitive on the Postgres side ("Admin" finds "admin"). A
    # phone number is matched in its normalised form, however it was typed.
    matches = [User.username == identifier, User.email == identifier]
    if (phone := normalize_phone(identifier)) is not None:
        matches.append(User.phone == phone)
    user = await db.scalar(select(User).where(or_(*matches)))
    if user is None or not verify_password(user.password_hash, payload.password):
        db.add(FailedLogin(identifier=identifier))
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_BAD_CREDENTIALS)

    await _ensure_may_sign_in(db, user)
    # A successful sign-in wipes the slate, so a few typos earlier don't
    # count toward a lockout later.
    await db.execute(delete(FailedLogin).where(FailedLogin.identifier == identifier))
    tokens = await issue_tokens(db, user)
    await db.commit()
    return tokens


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    """Trades a refresh token for a new pair, revoking the old one."""
    # Row-locked so two simultaneous refreshes with the same token (e.g.
    # two browser tabs waking up at once) can't both succeed.
    row = await db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_opaque_token(payload.refresh_token))
        .with_for_update()
    )
    if row is None or row.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired — sign in again")
    if row.rotated_at is not None:
        # This token was already exchanged once, and refresh tokens are
        # single-use -- so it's either a stale tab or a copied token being
        # replayed. Not knowing which, end every session for this user:
        # the genuine owner just signs in again; a thief loses access.
        await revoke_all_sessions(db, row.user_id)
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired — sign in again")
    if row.revoked_at is not None:
        # Signed out (or signed out everywhere by a password change or
        # deactivation) -- just refused, nothing suspicious about it.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired — sign in again")

    user = await db.get(User, row.user_id)
    await _ensure_may_sign_in(db, user)
    now = datetime.now(UTC)
    row.revoked_at = now
    row.rotated_at = now
    tokens = await issue_tokens(db, user)
    await db.commit()
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> Response:
    """Ends this device's session. Always 204, even for an unknown or
    already-revoked token -- signing out should never show an error."""
    await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_opaque_token(payload.refresh_token),
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/change-password", response_model=TokenPair)
async def change_password(
    payload: ChangePasswordRequest,
    claims: dict[str, Any] = Depends(get_current_auth_user),
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    """Sets a new password for the signed-in user and signs out every
    *other* device: all sessions are revoked, and this device gets a fresh
    pair back so it carries on uninterrupted. Also clears
    must_change_password, which is how the bootstrap owner gets past the
    forced first-sign-in password screen."""
    user = await _user_from_claims(db, claims)
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    await revoke_all_sessions(db, user.id)
    tokens = await issue_tokens(db, user)
    await db.commit()
    return tokens


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)) -> dict:
    """Emails a reset link if this email has an account. Responds the same
    way whether or not it does, so this can't be used to check which
    emails are registered."""
    user = await db.scalar(select(User).where(User.email == payload.email.strip()))
    if user is not None:
        link = await create_one_time_link(db, user, OneTimeTokenPurpose.password_reset)
        await db.commit()
        await send_email(
            user.email,
            "Reset your Belin-Pok password",
            "Someone (hopefully you) asked to reset your Belin-Pok password.\n\n"
            f"Choose a new one here — the link works once, for the next hour:\n{link}\n\n"
            "If this wasn't you, you can ignore this email; your password hasn't changed.",
        )
    return {"detail": "If that email has an account, a reset link is on its way."}


@router.post("/set-password", response_model=TokenPair)
async def set_password_with_token(
    payload: SetPasswordWithTokenRequest, db: AsyncSession = Depends(get_db)
) -> TokenPair:
    """Redeems an invite or reset link: sets the password and signs the
    person straight in, so accepting an invite lands them in the app."""
    row = await db.scalar(
        select(OneTimeToken).where(OneTimeToken.token_hash == hash_opaque_token(payload.token)).with_for_update()
    )
    if row is None or row.used_at is not None or row.expires_at <= datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This link has expired or was already used — ask for a new one",
        )

    user = await db.get(User, row.user_id)
    await _ensure_may_sign_in(db, user)
    now = datetime.now(UTC)
    # Burn every outstanding link for this user, not just this one: once a
    # password is set, an older invite/reset email lying around shouldn't
    # still be able to change it.
    await db.execute(
        update(OneTimeToken).where(OneTimeToken.user_id == user.id, OneTimeToken.used_at.is_(None)).values(used_at=now)
    )
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    await revoke_all_sessions(db, user.id)
    tokens = await issue_tokens(db, user)
    await db.commit()
    return tokens


@router.post("/signup", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    """Storefront self-registration: the login and the customer profile,
    created together in one transaction.

    An email that already belongs to a customer record -- e.g. from an
    earlier guest checkout, or a wholesale account staff set up -- is
    refused rather than linked. Linking would hand that record's order
    history and addresses (or a wholesale credit account) to whoever
    signs up first with the email, and nothing here verifies they own it.
    """
    email = payload.email.strip()
    if await db.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists — sign in instead"
        )

    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    await db.flush()
    db.add(
        Customer(
            auth_user_id=user.id,
            full_name=payload.full_name,
            email=email,
            phone=payload.phone,
            customer_type=CustomerType.retail,
            status=CustomerStatus.approved,
        )
    )
    try:
        await db.flush()
    except IntegrityError as exc:
        # customers.email is unique too -- see the docstring for why this
        # isn't merged into the existing record.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already on file with the shop — contact us to set up your account",
        ) from exc

    tokens = await issue_tokens(db, user)
    await db.commit()
    return tokens
