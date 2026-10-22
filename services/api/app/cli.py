"""One-off admin commands, run from a shell with the API's environment
(locally, or `railway run` / a Railway shell in production).

    python -m app.cli create-owner --username admin --password admin

create-owner solves the chicken-and-egg of a brand-new database: staff
are normally invited by an owner (app/routers/staff.py), but the first
owner has nobody to invite them. It creates a sign-in for a username (and
optionally an email) plus an active `owner` staff row.

By default the account is flagged must_change_password, so the admin app
makes whoever signs in first pick a real password before doing anything
else -- important when the starting password is something guessable
like "admin" on an app that's reachable from the internet. Pass
--no-force-change to skip that.
"""

import argparse
import asyncio
import sys

from sqlalchemy import or_, select

from app.db import async_session_factory
from app.models import Staff, StaffRole, User
from app.security import hash_password


async def create_owner(
    username: str, password: str, *, email: str | None, full_name: str, force_change: bool
) -> User:
    """Creates the owner account; raises ValueError if the username/email
    is already taken, rather than silently resetting someone's password."""
    async with async_session_factory() as session:
        taken = [User.username == username, *([User.email == email] if email else [])]
        clash = await session.scalar(select(User.id).where(or_(*taken)))
        if clash is not None:
            raise ValueError(f"An account with username/email {username!r} already exists")

        user = User(
            username=username,
            email=email,
            # Deliberately not held to the 8-character minimum the API
            # enforces on passwords people choose (see app/schemas.py) --
            # this command takes whatever it's given, and force_change is
            # what brings it up to standard on first sign-in.
            password_hash=hash_password(password),
            must_change_password=force_change,
        )
        session.add(user)
        await session.flush()
        session.add(Staff(id=user.id, email=email, full_name=full_name, role=StaffRole.owner, is_active=True))
        await session.commit()
        return user


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)

    owner = commands.add_parser("create-owner", help="create the first owner account")
    owner.add_argument("--username", required=True)
    owner.add_argument("--password", required=True)
    owner.add_argument("--email", default=None, help="optional; lets this account use 'forgot password'")
    owner.add_argument("--full-name", default="Owner")
    owner.add_argument(
        "--no-force-change",
        dest="force_change",
        action="store_false",
        help="don't require a new password on first sign-in",
    )

    args = parser.parse_args(argv)
    try:
        user = asyncio.run(
            create_owner(
                args.username,
                args.password,
                email=args.email,
                full_name=args.full_name,
                force_change=args.force_change,
            )
        )
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1

    note = " -- a new password will be required on first sign-in" if args.force_change else ""
    print(f"Created owner {user.username!r} ({user.id}){note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
