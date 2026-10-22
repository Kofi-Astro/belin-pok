"""Signing in for real, end to end: no dependency overrides here (unlike
most tests -- see conftest.py), so every request below goes through real
password hashing, real signed access tokens and the real refresh-token
table, and protected routes are reached with an actual bearer token."""

import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import text

from app.cli import create_owner
from app.config import get_settings
from app.db import async_session_factory
from app.migrate import apply_migrations


@pytest.fixture
async def created():
    """Collects every username/email a test signs up or creates, and
    deletes those accounts (and their failed-login records) afterwards.
    Staff/customer rows and sessions go with them via ON DELETE CASCADE,
    except customers, which only SET NULL and so are deleted explicitly."""
    identifiers: list[str] = []
    yield identifiers
    async with async_session_factory() as session:
        for identifier in identifiers:
            params = {"i": identifier}
            await session.execute(text("delete from customers where email = :i"), params)
            await session.execute(text("delete from users where username = :i or email = :i"), params)
            await session.execute(text("delete from failed_logins where identifier = :i"), params)
        await session.commit()


async def _owner(created, *, password: str = "admin", force_change: bool = True) -> str:
    """A bootstrap owner made exactly the way `python -m app.cli
    create-owner` makes one. Returns its (unique) username."""
    username = f"admin-{uuid.uuid4().hex[:8]}"
    created.append(username)
    await create_owner(username, password, email=None, full_name="Test Owner", force_change=force_change)
    return username


async def _login(ac, identifier: str, password: str):
    return await ac.post("/auth/login", json={"identifier": identifier, "password": password})


def _bearer(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _token_from_link(link: str) -> str:
    # The token sits in the URL fragment's query ("/#/set-password?token=..."),
    # since the apps use hash routing -- see create_one_time_link.
    return parse_qs(urlparse(urlparse(link).fragment).query)["token"][0]


# ---------- bootstrap owner + sign-in ----------


async def test_bootstrap_owner_signs_in_with_username_and_must_change_password(fresh_client, created):
    username = await _owner(created)
    async with fresh_client() as ac:
        # Usernames are case-insensitive (citext).
        res = await _login(ac, username.upper(), "admin")
        assert res.status_code == 200, res.text
        tokens = res.json()
        assert tokens["must_change_password"] is True

        me = await ac.get("/staff/me", headers=_bearer(tokens))
    assert me.status_code == 200, me.text
    assert me.json()["role"] == "owner"
    assert me.json()["email"] is None


async def test_wrong_password_and_unknown_user_get_the_same_answer(fresh_client, created):
    username = await _owner(created)
    unknown = f"nobody-{uuid.uuid4().hex[:8]}"
    created.append(unknown)
    async with fresh_client() as ac:
        wrong = await _login(ac, username, "not-it")
        missing = await _login(ac, unknown, "whatever")
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json()["detail"] == missing.json()["detail"]


async def test_repeated_wrong_passwords_are_throttled_even_for_the_right_one(fresh_client, created):
    username = await _owner(created)
    async with fresh_client() as ac:
        for _ in range(10):
            assert (await _login(ac, username, "guess")).status_code == 401
        throttled = await _login(ac, username, "admin")
    assert throttled.status_code == 429


async def test_garbage_and_missing_tokens_are_rejected(fresh_client):
    async with fresh_client() as ac:
        missing = await ac.get("/staff/me")
        garbage = await ac.get("/staff/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert missing.status_code == garbage.status_code == 401


async def test_customer_token_cannot_reach_staff_routes(fresh_client, created):
    email = f"shopper-{uuid.uuid4().hex[:8]}@example.com"
    created.append(email)
    async with fresh_client() as ac:
        signup = await ac.post(
            "/auth/signup", json={"email": email, "password": "long-enough-1", "full_name": "Shopper"}
        )
        staff_only = await ac.get("/staff/me", headers=_bearer(signup.json()))
    assert staff_only.status_code == 403


# ---------- sessions: refresh, logout, change password ----------


async def test_refresh_rotates_and_a_reused_refresh_token_ends_every_session(fresh_client, created):
    username = await _owner(created)
    async with fresh_client() as ac:
        first = (await _login(ac, username, "admin")).json()

        rotated = await ac.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        assert rotated.status_code == 200, rotated.text
        second = rotated.json()
        assert second["refresh_token"] != first["refresh_token"]

        # Replaying the already-used token looks like theft: it fails, and
        # takes the legitimately rotated session down with it.
        replay = await ac.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        assert replay.status_code == 401
        after_replay = await ac.post("/auth/refresh", json={"refresh_token": second["refresh_token"]})
    assert after_replay.status_code == 401


async def test_logout_revokes_the_refresh_token(fresh_client, created):
    username = await _owner(created)
    async with fresh_client() as ac:
        tokens = (await _login(ac, username, "admin")).json()
        logout = await ac.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
        assert logout.status_code == 204
        # Logging out twice is still fine -- never an error.
        assert (await ac.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})).status_code == 204
        refreshed = await ac.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 401


async def test_change_password_clears_the_forced_change_and_signs_out_other_devices(fresh_client, created):
    username = await _owner(created)
    async with fresh_client() as ac:
        phone = (await _login(ac, username, "admin")).json()
        laptop = (await _login(ac, username, "admin")).json()

        too_short = await ac.post("/auth/change-password", json={"new_password": "short"}, headers=_bearer(laptop))
        assert too_short.status_code == 422

        changed = await ac.post(
            "/auth/change-password", json={"new_password": "a-much-better-one"}, headers=_bearer(laptop)
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["must_change_password"] is False

        # The other device's session is gone; the device that changed it
        # carries on with the fresh pair it got back.
        assert (await ac.post("/auth/refresh", json={"refresh_token": phone["refresh_token"]})).status_code == 401
        refreshed = await ac.post("/auth/refresh", json={"refresh_token": changed.json()["refresh_token"]})
        assert refreshed.status_code == 200

        assert (await _login(ac, username, "admin")).status_code == 401
        relogin = await _login(ac, username, "a-much-better-one")
    assert relogin.status_code == 200
    assert relogin.json()["must_change_password"] is False


# ---------- staff invites ----------


async def test_invited_staff_sets_password_from_link_and_link_is_single_use(fresh_client, created):
    owner = await _owner(created, force_change=False)
    email = f"new-staff-{uuid.uuid4().hex[:8]}@example.com"
    created.append(email)
    async with fresh_client() as ac:
        owner_tokens = (await _login(ac, owner, "admin")).json()
        invite = await ac.post(
            "/staff/invite",
            json={"email": email, "full_name": "New Hire", "role": "order_fulfillment"},
            headers=_bearer(owner_tokens),
        )
        assert invite.status_code == 201, invite.text
        link = invite.json()["invite_link"]
        assert link.startswith(get_settings().admin_app_url.rstrip("/") + "/#/set-password?token=")

        # No password yet, so they can't sign in until they use the link.
        assert (await _login(ac, email, "anything-at-all")).status_code == 401

        accepted = await ac.post(
            "/auth/set-password", json={"token": _token_from_link(link), "new_password": "my-new-password"}
        )
        assert accepted.status_code == 200, accepted.text
        me = await ac.get("/staff/me", headers=_bearer(accepted.json()))
        assert me.json()["role"] == "order_fulfillment"

        reused = await ac.post(
            "/auth/set-password", json={"token": _token_from_link(link), "new_password": "another-password"}
        )
    assert reused.status_code == 400


async def test_deactivated_staff_cannot_sign_in_or_refresh(fresh_client, created):
    owner = await _owner(created, force_change=False)
    email = f"leaver-{uuid.uuid4().hex[:8]}@example.com"
    created.append(email)
    async with fresh_client() as ac:
        owner_auth = _bearer((await _login(ac, owner, "admin")).json())
        invite = (
            await ac.post("/staff/invite", json={"email": email, "full_name": "Leaver"}, headers=owner_auth)
        ).json()
        staff_tokens = (
            await ac.post(
                "/auth/set-password",
                json={"token": _token_from_link(invite["invite_link"]), "new_password": "leaver-password"},
            )
        ).json()

        deactivate = await ac.patch(f"/staff/{invite['id']}", json={"is_active": False}, headers=owner_auth)
        assert deactivate.status_code == 200

        relogin = await _login(ac, email, "leaver-password")
        refreshed = await ac.post("/auth/refresh", json={"refresh_token": staff_tokens["refresh_token"]})
        # Even the still-unexpired access token stops working at once,
        # because get_current_staff checks is_active on every request.
        still_in = await ac.get("/staff/me", headers=_bearer(staff_tokens))
    assert relogin.status_code == 403
    assert refreshed.status_code == 401
    assert still_in.status_code == 403


# ---------- password reset ----------


async def test_forgot_password_answers_the_same_and_reset_link_works(fresh_client, created, monkeypatch):
    sent: list[tuple[str, str]] = []

    async def capture(to, subject, body):
        sent.append((to, body))
        return True

    monkeypatch.setattr("app.routers.auth.send_email", capture)

    email = f"forgetful-{uuid.uuid4().hex[:8]}@example.com"
    created.append(email)
    async with fresh_client() as ac:
        await ac.post("/auth/signup", json={"email": email, "password": "original-pass", "full_name": "F"})

        known = await ac.post("/auth/forgot-password", json={"email": email})
        unknown = await ac.post("/auth/forgot-password", json={"email": f"x-{email}"})
        assert known.status_code == unknown.status_code == 202
        assert known.json() == unknown.json()
        assert [to for to, _ in sent] == [email]

        # A customer's reset link points at the storefront, not the admin app.
        link = next(word for word in sent[0][1].split() if "token=" in word)
        assert link.startswith(get_settings().storefront_url.rstrip("/") + "/#/reset-password?token=")
        reset = await ac.post(
            "/auth/set-password", json={"token": _token_from_link(link), "new_password": "remembered-now"}
        )
        assert reset.status_code == 200, reset.text
        relogin = await _login(ac, email, "remembered-now")
    assert relogin.status_code == 200


# ---------- storefront sign-up ----------


async def test_signup_creates_login_and_customer_in_one_step(fresh_client, created):
    email = f"new-shopper-{uuid.uuid4().hex[:8]}@example.com"
    created.append(email)
    async with fresh_client() as ac:
        res = await ac.post(
            "/auth/signup",
            json={"email": email, "password": "shop-password", "full_name": "Ama Shopper", "phone": "0551234567"},
        )
        assert res.status_code == 201, res.text
        me = await ac.get("/customers/me", headers=_bearer(res.json()))
        twice = await ac.post("/auth/signup", json={"email": email, "password": "shop-password", "full_name": "A"})
    assert me.status_code == 200
    assert me.json()["email"] == email
    assert me.json()["customer_type"] == "retail"
    assert me.json()["status"] == "approved"
    assert twice.status_code == 409


async def test_signup_refuses_an_email_already_on_file_from_a_guest_order(fresh_client, created):
    """Linking would hand that earlier record's history to whoever signs
    up first with the email, unverified -- see signup()'s docstring."""
    email = f"guest-{uuid.uuid4().hex[:8]}@example.com"
    created.append(email)
    async with async_session_factory() as session:
        await session.execute(
            text("insert into customers (full_name, email) values ('Earlier Guest', :e)"), {"e": email}
        )
        await session.commit()
    async with fresh_client() as ac:
        res = await ac.post("/auth/signup", json={"email": email, "password": "shop-password", "full_name": "Guest"})
    assert res.status_code == 409
    async with async_session_factory() as session:
        # Rolled back as a whole: no orphaned login left behind either.
        leftover = await session.scalar(text("select count(*) from users where email = :e"), {"e": email})
    assert leftover == 0


# ---------- migrations ----------


async def test_migrations_are_already_applied_and_rerunning_is_a_no_op():
    assert await apply_migrations(get_settings().database_url) == []


async def test_email_sign_in_ignores_case(fresh_client, created):
    """Regression test for CIText (see app/models.py): with emails mapped
    as plain str, the driver's VARCHAR cast made this comparison
    case-sensitive despite the citext column."""
    email = f"case-{uuid.uuid4().hex[:8]}@example.com"
    created.append(email)
    async with fresh_client() as ac:
        await ac.post("/auth/signup", json={"email": email, "password": "shop-password", "full_name": "C"})
        res = await _login(ac, email.upper(), "shop-password")
    assert res.status_code == 200, res.text
