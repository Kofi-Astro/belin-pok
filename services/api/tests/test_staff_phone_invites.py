"""Inviting staff by phone (link passed on by SMS/WhatsApp) as well as by
email, and signing in with a phone number however it's typed."""

import random
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import text

from app.db import async_session_factory
from app.phone import international, normalize_phone


@pytest.fixture
async def phones():
    """Removes the accounts created for the phone numbers a test uses."""
    used: list[str] = []
    yield used
    async with async_session_factory() as session:
        for phone in used:
            await session.execute(text("delete from users where phone = :p"), {"p": phone})
        await session.commit()


def _new_phone() -> tuple[str, str]:
    """A random Ghana mobile number: (as someone might type it, stored form)."""
    rest = f"{random.randint(0, 99_999_999):08d}"
    return f"+233 2{rest[:1]} {rest[1:4]} {rest[4:]}", f"02{rest}"


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("0241234567", "0241234567"),
        ("024 123 4567", "0241234567"),
        ("+233 24 123 4567", "0241234567"),
        ("233-24-123-4567", "0241234567"),
        ("241234567", "0241234567"),
        ("+44 7700 900123", "+447700900123"),
        ("12345", None),
        ("admin", None),
        ("someone@example.com", None),
    ],
)
def test_phone_numbers_are_stored_one_way(typed, stored):
    assert normalize_phone(typed) == stored


def test_international_form():
    assert international("0241234567") == "233241234567"
    assert international("+447700900123") == "447700900123"


async def test_invite_by_phone_and_sign_in_with_it(client, fresh_client, phones):
    typed, stored = _new_phone()
    phones.append(stored)
    async with client as ac:
        res = await ac.post(
            "/staff/invite", json={"phone": typed, "full_name": "Phone Staff", "roles": ["order_fulfillment"]}
        )
        assert res.status_code == 201, res.text
        invited = res.json()
        assert (invited["phone"], invited["email"], invited["email_sent"]) == (stored, None, False)
        token = parse_qs(urlparse(invited["invite_link"]).query)["token"][0]
        await ac.post("/auth/set-password", json={"token": token, "new_password": "phone-password"})

        # The same number again is someone who already has an account.
        again = await ac.post("/staff/invite", json={"phone": stored, "full_name": "Twin"})
        assert again.status_code == 409

    async with fresh_client() as ac:
        # Typed differently from how it was invited -- still the same account.
        local = f"{stored[:3]} {stored[3:6]} {stored[6:]}"
        signed_in = await ac.post("/auth/login", json={"identifier": local, "password": "phone-password"})
    assert signed_in.status_code == 200, signed_in.text


async def test_an_invite_needs_an_email_or_a_phone(client):
    async with client as ac:
        neither = await ac.post("/staff/invite", json={"full_name": "Nobody"})
        bad_phone = await ac.post("/staff/invite", json={"full_name": "Typo", "phone": "024"})
        bad_email = await ac.post("/staff/invite", json={"full_name": "Typo", "email": "not-an-email"})
    assert (neither.status_code, bad_phone.status_code, bad_email.status_code) == (422, 422, 422)
