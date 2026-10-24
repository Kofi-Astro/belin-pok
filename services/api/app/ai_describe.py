"""Drafting a product's storefront description from its photo, with Claude.

Staff often don't know what to write about an item, so the admin's
product page has a "Write a description" button: the API sends the
product's cover photo plus what's already known about it (name, category,
brand, types, sizes, colours) to Claude and returns a short draft. Nothing
is saved here -- the draft goes into the description box for staff to
read, correct and save themselves, because a photo can't tell anyone the
fabric, the fit or whether a brand is genuine.

Model and settings (see the Claude API guidance this follows):
  - claude-opus-5-5, the current default model; effort "low" because this
    is a short, routine writing task.
  - Structured output (output_config.format): the reply is guaranteed to
    be JSON matching _SCHEMA, so there's no text to pick apart.
  - Server-side refusal fallback ("default"): if Claude's safety checks
    ever decline a photo, Anthropic re-runs it on its recommended
    fallback model within the same call instead of returning nothing.
  - Photos are shrunk to at most 1568 px on the long side first: phone
    photos (up to 10 MB here) exceed Claude's 5 MB per-image limit, and a
    smaller image costs fewer tokens with no loss for this purpose.
Roughly 1-2 US cents per draft at Claude Opus 5.5's prices.
"""

import base64
import io
import json
from dataclasses import dataclass

import anthropic
from PIL import Image, ImageOps

from app.config import get_settings

MODEL = "claude-opus-5-5"
_MAX_SIDE = 1568

_SYSTEM = """You write product descriptions for Belin-Pok, a menswear shop in Ghana \
selling caps, t-shirts, jackets, sweatshirts, shorts, joggers, boxers and socks, \
retail and wholesale. Each description appears on the shop's website under the \
product photo.

Write 2 to 4 short sentences in plain, friendly English for a shopper deciding \
whether to buy. Describe what the photo shows: the kind of garment, its colour \
and pattern, visible details (collar, pockets, cuffs, drawstrings, prints, \
stitching) and the style or occasions it suits.

Only state what you can see or what you are told. Do not guess fabric, fit, \
sizing, care instructions or country of origin. Do not name or imply a brand \
unless the shop gives one. No prices, no claims like "best" or "premium \
quality", no emojis, no hashtags, no headings. If the photo doesn't clearly \
show a clothing item, say briefly in the description what it does show instead."""

# What Claude returns. colour: the main colour as a shopper would name it.
_SCHEMA = {
    "type": "object",
    "properties": {
        "description": {"type": "string"},
        "colour": {"type": ["string", "null"]},
    },
    "required": ["description", "colour"],
    "additionalProperties": False,
}


class DescriptionUnavailable(Exception):
    """The draft couldn't be produced; the message is fit to show staff."""


@dataclass
class DescriptionDraft:
    description: str
    colour: str | None


def is_configured() -> bool:
    return bool(get_settings().anthropic_api_key)


def _prepare_photo(data: bytes) -> tuple[str, str]:
    """The photo as base64 JPEG, at most _MAX_SIDE px on its long side and
    the right way up (phone photos often rely on an EXIF rotation tag)."""
    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image)
        image.thumbnail((_MAX_SIDE, _MAX_SIDE))
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        out = io.BytesIO()
        image.save(out, format="JPEG", quality=88)
    except Exception as exc:  # Pillow raises several types for bad files
        raise DescriptionUnavailable("The cover photo couldn't be read as an image.") from exc
    return base64.standard_b64encode(out.getvalue()).decode("ascii"), "image/jpeg"


async def draft_description(photo: bytes, facts: list[str]) -> DescriptionDraft:
    """Asks Claude for a draft. `facts` are lines of what the shop already
    knows ("Name: Joggers", "Types: Standard, Premium") -- given to Claude as
    information to use, not to invent beyond."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise DescriptionUnavailable(
            "Writing descriptions from photos isn't set up yet (the API needs an ANTHROPIC_API_KEY)."
        )
    image_data, media_type = _prepare_photo(photo)
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=90)
    try:
        response = await client.beta.messages.create(
            model=MODEL,
            max_tokens=2000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": _SCHEMA}},
            system=_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_data}},
                        {
                            "type": "text",
                            "text": "What the shop knows about this product:\n"
                            + "\n".join(facts)
                            + "\n\nWrite the description.",
                        },
                    ],
                }
            ],
        )
    except anthropic.AuthenticationError as exc:
        raise DescriptionUnavailable("The Anthropic API key was rejected — check ANTHROPIC_API_KEY.") from exc
    except anthropic.RateLimitError as exc:
        raise DescriptionUnavailable("Too many requests just now — try again in a minute.") from exc
    except anthropic.APIStatusError as exc:
        raise DescriptionUnavailable(f"The writing service returned an error ({exc.status_code}). Try again.") from exc
    except anthropic.APIConnectionError as exc:
        raise DescriptionUnavailable("Couldn't reach the writing service. Try again.") from exc

    if response.stop_reason == "refusal":
        raise DescriptionUnavailable("This photo couldn't be described automatically — please write it yourself.")
    if response.stop_reason == "max_tokens":
        raise DescriptionUnavailable("The draft came back incomplete. Try again.")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        raise DescriptionUnavailable("No draft came back. Try again.")
    data = json.loads(text)
    colour = (data.get("colour") or "").strip() or None
    return DescriptionDraft(description=data["description"].strip(), colour=colour)
