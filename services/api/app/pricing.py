"""In-store vs online prices.

The prices staff enter -- products.base_price and a variant's
price_override -- are the **in-store** prices, which the till charges.
Online (storefront website and phone app) prices are higher, to cover
what selling online costs:

    online price = the variant's own online_price, if set,
                   otherwise in-store price x (1 + markup%), rounded *up*
                   to a multiple of the rounding step (if one is set).

Everything that shows or charges an online price goes through here:
the public catalogue (app/routers/public.py) and checkout
(app/routers/orders.py). The admin mirrors the same formula to preview
prices (apps/admin-web/src/lib/pricing.ts).
"""

from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Product, ProductVariant, ShopSettings
from app.schemas import ProductWithVariants

_CENT = Decimal("0.01")


async def get_shop_settings(db: AsyncSession) -> ShopSettings:
    # The migration inserts the single row; get() is cached per session.
    return await db.get(ShopSettings, 1)


def in_store_price(product: Product, variant: ProductVariant) -> Decimal:
    return Decimal(str(variant.price_override if variant.price_override is not None else product.base_price))


def apply_markup(amount: float | Decimal, settings: ShopSettings) -> Decimal:
    """An in-store amount as its online equivalent (no per-variant override)."""
    raw = Decimal(str(amount)) * (1 + Decimal(str(settings.online_markup_percent)) / 100)
    step = Decimal(str(settings.online_price_rounding))
    if step > 0:
        raw = (raw / step).to_integral_value(rounding=ROUND_CEILING) * step
    return raw.quantize(_CENT, rounding=ROUND_HALF_UP)


def online_price(product: Product, variant: ProductVariant, settings: ShopSettings) -> Decimal:
    if variant.online_price is not None:
        return Decimal(str(variant.online_price)).quantize(_CENT)
    return apply_markup(in_store_price(product, variant), settings)


def public_view(product: Product, settings: ShopSettings) -> ProductWithVariants:
    """A product as shoppers see it: every price is the online price, and
    nothing about in-store, wholesale or pack pricing is included.

    Field names stay as they were (base_price, price_override), so the
    phone app and the website keep working unchanged -- they simply now
    receive online prices in them. A variant whose online price equals the
    product's online base price gets price_override = null, as before."""
    view = ProductWithVariants.model_validate(product)
    base = apply_markup(product.base_price, settings)
    view.base_price = float(base)
    variants_by_id = {v.id: v for v in product.variants}
    for v in view.variants:
        price = online_price(product, variants_by_id[v.id], settings)
        v.price_override = None if price == base else float(price)
        v.online_price = None
        v.wholesale_price = None
        v.pack_price = None
        v.pack_size = None
    return view
