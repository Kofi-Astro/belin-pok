"""Calendar days in the shop's own timezone (Settings.shop_timezone).

Reports and the sales journal are asked for whole days ("1 Oct to 7
Oct"); a day starts at midnight where the shop is, not on the server's
clock. These turn those dates into the exact UTC instants to filter
timestamptz columns by.
"""

from datetime import date, datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.config import get_settings


@lru_cache
def shop_zone() -> ZoneInfo:
    return ZoneInfo(get_settings().shop_timezone)


def today() -> date:
    return datetime.now(shop_zone()).date()


def day_range(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """[start, end) covering date_from through date_to inclusive, as aware
    datetimes -- compare with `created_at >= start and created_at < end`."""
    zone = shop_zone()
    start = datetime.combine(date_from, time.min, tzinfo=zone)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=zone)
    return start, end
