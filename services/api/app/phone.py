"""Phone numbers, for staff who sign in with one (see
migrations/20261023120005_staff_phone_sign_in.sql).

People type numbers every which way -- "024 123 4567", "+233241234567",
"233-24-123-4567" -- so they're stored and looked up in one form: Ghana's
local format, 0 followed by 9 digits. A number in any other form (another
country's, say) is kept as its digits with a leading +, so it still
matches itself consistently.
"""

import re


def normalize_phone(raw: str) -> str | None:
    """The stored form of a phone number, or None if it isn't one (fewer
    than 9 digits, or letters in it -- so a username or email never
    accidentally reads as a phone number)."""
    text = raw.strip()
    if not re.fullmatch(r"\+?[\d\s\-().]+", text):
        return None
    digits = re.sub(r"\D", "", text)
    if len(digits) < 9:
        return None
    if digits.startswith("233") and len(digits) == 12:
        return "0" + digits[3:]
    if len(digits) == 10 and digits.startswith("0"):
        return digits
    if len(digits) == 9:
        return "0" + digits
    return "+" + digits


def international(phone: str) -> str:
    """Digits only, with the country code -- the form WhatsApp links and SMS
    providers want ("0241234567" -> "233241234567")."""
    if phone.startswith("+"):
        return phone[1:]
    return "233" + phone[1:]
