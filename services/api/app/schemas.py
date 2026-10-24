"""Pydantic request/response models, grouped by resource with a
`# ---------- name ----------` header. Each resource generally follows the
same four-class shape:

- `*Base`: fields shared by Create and Read (validation rules live here).
- `*Create`: the POST request body -- usually just `*Base`, occasionally
  with extra fields that only make sense at creation time.
- `*Update`: the PATCH request body -- every field optional, so a request
  only needs to include what's actually changing.
- `*Read`: the API response shape, with `model_config = ConfigDict(from_attributes=True)`
  so it can be built directly from a SQLAlchemy model instance (see
  app/models.py for the ORM side of each of these).

Comments below call out only where a resource deviates from that pattern
or has a non-obvious validation rule.
"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import (
    CreditLedgerEntryType,
    CustomerStatus,
    CustomerType,
    DevicePlatform,
    FulfillmentMethod,
    OrderStatus,
    OrderType,
    PaymentMethod,
    PriceTier,
    ProductStatus,
    StaffRole,
    StockMovementType,
)
from app.phone import normalize_phone


class HealthResponse(BaseModel):
    status: str = "ok"


# ---------- categories ----------


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=200, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    parent_id: uuid.UUID | None = None
    description: str | None = None
    display_order: int = 0
    # Storefront tile photo (from POST /uploads/product-photo), or None.
    image_path: str | None = Field(default=None, max_length=500)


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=200, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    parent_id: uuid.UUID | None = None
    description: str | None = None
    display_order: int | None = None
    image_path: str | None = Field(default=None, max_length=500)


class CategoryRead(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


# ---------- product variants ----------


def _validate_pack_pair(pack_price: float | None, pack_size: int | None) -> None:
    if (pack_price is None) != (pack_size is None):
        raise ValueError("pack_price and pack_size must be set together, or both left unset")


class ProductVariantBase(BaseModel):
    size: str = Field(min_length=1, max_length=50)
    color: str | None = None
    # "Type / quality" (Standard, Premium, Nike...), or None for products
    # without types. Blank is treated as None.
    style: str | None = Field(default=None, max_length=50)
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    price_override: float | None = Field(default=None, ge=0)
    # Bulk/loose wholesale unit price. Falls back to the retail price
    # (price_override, or the product's base_price) when unset -- most
    # variants are never sold wholesale, so that's the common case, not an
    # error condition.
    wholesale_price: float | None = Field(default=None, ge=0)
    # Price for one factory-packed bundle of pack_size units. Both must be
    # set together (checked below and by a matching DB constraint).
    pack_price: float | None = Field(default=None, ge=0)
    pack_size: int | None = Field(default=None, gt=0)
    # A fixed online price, instead of in-store price + the shop's online
    # markup (app/pricing.py). Null = use the markup.
    online_price: float | None = Field(default=None, ge=0)
    low_stock_threshold: int = Field(default=5, ge=0)
    is_active: bool = True

    @field_validator("pack_size")
    @classmethod
    def pack_price_and_size_together(cls, value: int | None, info) -> int | None:
        _validate_pack_pair(info.data.get("pack_price"), value)
        return value

    @field_validator("style", mode="before")
    @classmethod
    def _blank_style_is_none(cls, value):
        return _blank_to_none(value)


class ProductVariantCreate(ProductVariantBase):
    # Optional: POST /products/{id}/variants auto-generates one from the
    # product's slug + size + color when omitted, so nobody has to invent
    # a unique code by hand. Still overridable for the rare case a real
    # SKU (e.g. from a supplier) needs to be used instead.
    sku: str | None = Field(default=None, min_length=1, max_length=100)


def _blank_to_none(value):
    """ " Premium " -> "Premium"; "" or "  " -> None (no type)."""
    if isinstance(value, str):
        return value.strip() or None
    return value


class ProductVariantUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    size: str | None = Field(default=None, min_length=1, max_length=50)
    color: str | None = None
    style: str | None = Field(default=None, max_length=50)
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    price_override: float | None = Field(default=None, ge=0)
    wholesale_price: float | None = Field(default=None, ge=0)
    pack_price: float | None = Field(default=None, ge=0)
    pack_size: int | None = Field(default=None, gt=0)
    online_price: float | None = Field(default=None, ge=0)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    is_active: bool | None = None

    @field_validator("style", mode="before")
    @classmethod
    def _blank_style_is_none(cls, value):
        return _blank_to_none(value)


class ProductVariantRead(ProductVariantBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    sku: str
    stock_quantity: int
    created_at: datetime
    updated_at: datetime


class LowStockVariantRead(ProductVariantRead):
    product_name: str
    image_storage_path: str | None


class InventoryVariantRead(ProductVariantRead):
    """One row of the admin's stock table (GET /variants): a variant plus
    enough about its product to recognize and filter it."""

    product_name: str
    product_status: ProductStatus
    category_id: uuid.UUID
    category_name: str
    image_storage_path: str | None


# ---------- product images ----------


class ProductImageCreate(BaseModel):
    storage_path: str = Field(min_length=1, max_length=500)
    variant_id: uuid.UUID | None = None
    alt_text: str | None = None
    is_primary: bool = False


class ProductImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    variant_id: uuid.UUID | None
    storage_path: str
    alt_text: str | None
    display_order: int
    is_primary: bool


# ---------- products ----------


class ProductBase(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    slug: str = Field(min_length=1, max_length=300, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    description: str | None = None
    category_id: uuid.UUID
    brand: str | None = None
    base_price: float = Field(ge=0)
    status: ProductStatus = ProductStatus.draft
    primary_supplier_id: uuid.UUID | None = None


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    slug: str | None = Field(default=None, min_length=1, max_length=300, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    description: str | None = None
    category_id: uuid.UUID | None = None
    brand: str | None = None
    base_price: float | None = Field(default=None, ge=0)
    status: ProductStatus | None = None
    primary_supplier_id: uuid.UUID | None = None


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    images: list[ProductImageRead] = []


class ProductWithVariants(ProductRead):
    variants: list[ProductVariantRead] = []


class StockIntakeCreate(BaseModel):
    """POST /products/receive -- goods arriving at the counter, in one
    request. Without product_id it's a brand-new item: only name, photo
    and quantity are required, and everything else gets a placeholder
    (see receive_stock in app/routers/products.py) that's filled in later
    before publishing. With product_id it's more stock of an existing
    item, so the new-item fields don't apply and are rejected rather than
    silently ignored."""

    product_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=300)
    # Already uploaded by the client, same as ProductImageCreate.storage_path.
    image_storage_path: str | None = Field(default=None, min_length=1, max_length=500)
    quantity: int = Field(gt=0)
    category_id: uuid.UUID | None = None
    base_price: float | None = Field(default=None, ge=0)
    size: str | None = Field(default=None, max_length=50)
    color: str | None = Field(default=None, max_length=50)
    style: str | None = Field(default=None, max_length=50)
    reason: str | None = None

    @field_validator("name", "size", "color", "style", "reason", mode="before")
    @classmethod
    def _blank_to_none(cls, value):
        # The admin form sends "" for an untouched optional field -- that
        # should mean "use the default", not a size/color literally named "".
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @model_validator(mode="after")
    def _new_item_or_restock(self) -> "StockIntakeCreate":
        if self.product_id is None:
            # The name can be left out when a category is given: the item is
            # then named after it ("Joggers"), with brand or quality as its
            # type rather than in its name.
            if (self.name is None and self.category_id is None) or self.image_storage_path is None:
                raise ValueError("A new item needs a photo, and a name or a category")
        elif any(v is not None for v in (self.name, self.image_storage_path, self.category_id, self.base_price)):
            raise ValueError("name, photo, category and price only apply to a new item, not a restock")
        return self


class ProductDescriptionDraft(BaseModel):
    """POST /products/{id}/describe: a draft for staff to review, never saved
    by the API. colour: the main colour Claude sees, as a hint."""

    description: str
    colour: str | None


class StockIntakeRead(BaseModel):
    product: ProductWithVariants
    variant: ProductVariantRead
    created_product: bool
    created_variant: bool


# ---------- stock movements ----------


class StockMovementCreate(BaseModel):
    variant_id: uuid.UUID
    movement_type: StockMovementType
    quantity_change: int = Field(description="Positive to add stock, negative to remove it. Cannot be 0.")
    reason: str | None = None
    reference_type: str | None = None
    reference_id: uuid.UUID | None = None

    @field_validator("quantity_change")
    @classmethod
    def quantity_change_not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("quantity_change cannot be 0")
        return value


class StockMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    variant_id: uuid.UUID
    movement_type: StockMovementType
    quantity_change: int
    reason: str | None
    reference_type: str | None
    reference_id: uuid.UUID | None
    performed_by: uuid.UUID | None
    created_at: datetime

    # Populated only by GET /stock-movements (joined in for the Inventory
    # screen's activity feed) -- absent on the plain object POST returns.
    product_name: str | None = None
    variant_sku: str | None = None
    variant_size: str | None = None
    variant_color: str | None = None
    variant_style: str | None = None
    performed_by_name: str | None = None
    performed_by_role: StaffRole | None = None
    unit_price: float | None = None


class DailySalesRead(BaseModel):
    day: date
    items_sold: int
    total_amount: float


# ---------- inventory rebalance ----------


class RebalanceLine(BaseModel):
    variant_id: uuid.UUID
    pack_count: int = Field(gt=0, description="How many packs to organize this variant's on-hand stock into.")


class RebalanceCreate(BaseModel):
    lines: list[RebalanceLine] = Field(min_length=1)
    note: str | None = None


class RebalanceLineResult(BaseModel):
    variant_id: uuid.UUID
    sku: str
    pack_count: int
    units_packed: int
    stock_quantity: int


class RebalanceResult(BaseModel):
    lines: list[RebalanceLineResult]


# ---------- POS sales ----------


class POSSaleItemCreate(BaseModel):
    # Exactly one of variant_id or category_id is the norm: pick a
    # cataloged SKU (price looked up server-side, never trusted from the
    # client), or "quick log" a sale by product type when there's no time
    # to hunt down the exact SKU by hand -- in which case unit_price is
    # staff-entered (there's nothing else to price it from) and can be
    # attached to a real variant later via POST .../identify.
    #
    # Neither is an "unsorted" line: a whole mixed basket rung up as one
    # amount when the shop is too busy to itemise it (quantity 1,
    # unit_price = the amount), broken down later via POST .../break-down
    # -- see migrations/20261023120004_pos_sale_unsorted_lines.sql.
    variant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=500)
    price_tier: PriceTier = PriceTier.retail
    # For price_tier='pack', this counts *packs*, not individual units --
    # e.g. quantity=3 on a pack_size=6 variant removes 18 units of stock at
    # 3 x pack_price. For 'retail'/'wholesale', quantity is plain units.
    quantity: int = Field(gt=0)
    # Only used (and required) for a quick-logged line (variant_id is
    # None) -- ignored otherwise, since a cataloged variant's price is
    # always looked up server-side.
    unit_price: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _variant_or_category(self) -> "POSSaleItemCreate":
        if self.variant_id is None:
            if self.unit_price is None:
                raise ValueError("A quick-logged or unsorted item (no variant_id) needs a unit_price")
            if self.price_tier == PriceTier.pack:
                raise ValueError("Pack pricing requires a specific variant_id")
            if self.category_id is None and self.quantity != 1:
                raise ValueError("An unsorted sale is one line for the whole amount (quantity 1)")
        return self


class POSSalePaymentCreate(BaseModel):
    method: PaymentMethod
    amount: float = Field(gt=0)


class POSSaleCreate(BaseModel):
    customer_id: uuid.UUID | None = None
    items: list[POSSaleItemCreate] = Field(min_length=1)
    payments: list[POSSalePaymentCreate] = Field(min_length=1)
    # An amount off the whole sale (e.g. a haggled ₵10), shared out across
    # the lines by the API. A reason is required with it: the owner sees
    # every discount, who gave it and why.
    discount: float = Field(default=0, ge=0)
    discount_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _discount_needs_reason(self) -> "POSSaleCreate":
        if self.discount > 0 and len((self.discount_reason or "").strip()) < 3:
            raise ValueError("Say why the discount was given")
        return self


class POSSalePaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    method: PaymentMethod
    amount: float


class POSSaleItemRead(BaseModel):
    id: uuid.UUID
    variant_id: uuid.UUID | None
    product_name: str | None
    variant_size: str | None
    variant_color: str | None
    variant_style: str | None = None
    category_id: uuid.UUID | None
    category_name: str | None
    note: str | None
    price_tier: PriceTier
    # Stock units removed by this line (already packs * pack_size for a
    # 'pack' line -- see POSSaleItemCreate).
    quantity: int
    unit_price: float
    # This line's share of the sale's discount; line_total is after it.
    discount: float = 0
    line_total: float
    pack_size: int | None = None
    # How many of this line have been brought back (see POSSaleReturnRead).
    returned_quantity: int = 0


class POSSaleItemIdentify(BaseModel):
    variant_id: uuid.UUID


class POSSaleBreakdownPart(BaseModel):
    """One component of a line being broken down: an exact product, or --
    if even that isn't known -- a type of item, which stays a quick-logged
    line to identify later. unit_price is what this part is taken to have
    cost, staff-entered: the money was already taken as one amount, so the
    parts share it out rather than being re-priced from the catalogue."""

    variant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    quantity: int = Field(gt=0)
    unit_price: float = Field(gt=0)
    price_tier: PriceTier = PriceTier.retail
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _names_something(self) -> "POSSaleBreakdownPart":
        if self.variant_id is None and self.category_id is None:
            raise ValueError("Each part needs a product (variant_id) or a type of item (category_id)")
        if self.price_tier == PriceTier.pack:
            raise ValueError("Parts are priced per item, not per pack")
        return self


class POSSaleItemBreakdown(BaseModel):
    parts: list[POSSaleBreakdownPart] = Field(min_length=1, max_length=100)


class POSSaleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID | None
    staff_id: uuid.UUID
    status: str
    created_at: datetime

    staff_name: str | None = None
    customer_name: str | None = None
    items: list[POSSaleItemRead] = []
    payments: list[POSSalePaymentRead] = []
    # subtotal is the till prices added up; total is what was charged
    # (subtotal - discount_total).
    subtotal: float = 0
    discount_total: float = 0
    discount_reason: str | None = None
    total: float = 0
    credit_amount: float = 0
    # Set on a voided sale -- who voided it, when, and the reason they gave.
    voided_at: datetime | None = None
    voided_by: uuid.UUID | None = None
    voided_by_name: str | None = None
    void_reason: str | None = None
    # Goods brought back later, newest last.
    returns: list["POSSaleReturnRead"] = []
    refunded_total: float = 0


class POSSaleReturnLine(BaseModel):
    sale_item_id: uuid.UUID
    quantity: int = Field(gt=0)


class POSSaleReturnCreate(BaseModel):
    """Goods coming back from a till sale. refund_amount is what's handed
    back -- the app suggests what they were sold for (after any discount),
    but it can be less, or 0 for an exchange."""

    items: list[POSSaleReturnLine] = Field(min_length=1)
    refund_amount: float = Field(default=0, ge=0)
    refund_method: PaymentMethod | None = None
    reason: str = Field(min_length=3, max_length=500)
    back_to_stock: bool = True

    @model_validator(mode="after")
    def _method_with_money(self) -> "POSSaleReturnCreate":
        if self.refund_amount > 0 and self.refund_method is None:
            raise ValueError("Say how the money was given back")
        return self


class POSSaleReturnItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sale_item_id: uuid.UUID
    quantity: int


class POSSaleReturnRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    refund_method: PaymentMethod | None
    refund_amount: float
    reason: str
    back_to_stock: bool
    staff_id: uuid.UUID
    staff_name: str | None = None
    created_at: datetime
    items: list[POSSaleReturnItemRead] = []


class POSSaleVoid(BaseModel):
    """Voiding needs a reason: it's the one action that makes a recorded
    sale's takings disappear, so the owner should always be able to see
    why it happened (see the sales journal and activity log)."""

    reason: str = Field(min_length=3, max_length=500)


# ---------- auth ----------
#
# See app/routers/auth.py. None of these follow the Base/Create/Update/Read
# shape -- they're one-off request/response bodies for the sign-in flows.

# Applies to every password a person chooses (sign-up, reset, change).
# The bootstrap owner account created by app/cli.py is the one exception,
# and it's flagged must_change_password so this rule catches up with it
# on first sign-in.
_PASSWORD = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    # A username or an email -- whichever the account has. See
    # app/models.py's User for why both exist.
    identifier: str = Field(min_length=1, max_length=320)
    # No minimum here: a sign-in attempt just has to match, and rejecting a
    # short one with a 422 would reveal the length rule to a guesser for
    # no benefit.
    password: str = Field(min_length=1, max_length=200)


class TokenPair(BaseModel):
    """What every successful sign-in-shaped call returns. The apps keep
    both: the short-lived access_token goes on every request, and the
    refresh_token is traded for a new pair when it expires."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    # Seconds until access_token expires, so the apps can refresh slightly
    # early instead of waiting for a 401.
    expires_in: int
    # True for an account that has to pick a new password before doing
    # anything else (the bootstrap owner) -- the admin app routes straight
    # to its set-password screen when this is set.
    must_change_password: bool


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=200)


class ChangePasswordRequest(BaseModel):
    # No "current password" field, deliberately matching the admin app's
    # existing change-password dialog: a valid access token already proves
    # who this is, and it's only ever minutes old.
    new_password: str = _PASSWORD


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class SetPasswordWithTokenRequest(BaseModel):
    """Redeems an invite or password-reset link (see OneTimeToken)."""

    token: str = Field(min_length=1, max_length=200)
    new_password: str = _PASSWORD


class SignupRequest(BaseModel):
    """Storefront self-registration, in one step: creates the login and
    the customer profile together (Supabase used to need a sign-up call,
    then a separate POST /customers/register). Always retail/approved --
    wholesale accounts are still staff-created via POST /customers."""

    email: str = Field(min_length=3, max_length=320)
    password: str = _PASSWORD
    full_name: str = Field(min_length=1, max_length=200)
    phone: str | None = None


# ---------- staff ----------


def _check_roles(roles: list[StaffRole]) -> list[StaffRole]:
    """A non-empty, de-duplicated set of roles. Owner already allows
    everything and Viewer is read-only, so neither combines with others;
    inventory_manager and order_fulfillment combine freely."""
    unique = list(dict.fromkeys(roles))
    if not unique:
        raise ValueError("Choose at least one role")
    if len(unique) > 1 and StaffRole.owner in unique:
        raise ValueError("Owner already includes every permission -- it can't be combined with other roles")
    if len(unique) > 1 and StaffRole.viewer in unique:
        raise ValueError("Viewer is read-only -- it can't be combined with other roles")
    return unique


class StaffRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # Null for a username-only account (the bootstrap owner) or someone
    # invited by phone only.
    email: str | None
    phone: str | None = None
    full_name: str
    # Everything this person can do is the union of these.
    roles: list[StaffRole]
    # The most senior of `roles`, for anywhere one label is shown.
    role: StaffRole
    is_active: bool
    created_at: datetime


class StaffInvite(BaseModel):
    # An email, a phone number, or both: the invite link is sent to
    # whichever the owner chooses (email by the API; SMS/WhatsApp from the
    # owner's own phone), and they sign in with either.
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    full_name: str = Field(min_length=1, max_length=200)
    roles: list[StaffRole] | None = None
    # Single-role form, still accepted; `roles` wins when both are given.
    role: StaffRole | None = None

    @model_validator(mode="after")
    def _resolve_roles(self) -> "StaffInvite":
        self.email = (self.email or "").strip() or None
        if self.email is not None and "@" not in self.email:
            raise ValueError("That email address doesn't look right")
        if self.phone is not None and self.phone.strip():
            normalised = normalize_phone(self.phone)
            if normalised is None:
                raise ValueError("That phone number doesn't look right")
            self.phone = normalised
        else:
            self.phone = None
        if self.email is None and self.phone is None:
            raise ValueError("Give an email address or a phone number to invite them with")
        # An explicitly empty list is a mistake to report, not "use the default".
        self.roles = _check_roles(self.roles if self.roles is not None else [self.role or StaffRole.viewer])
        return self


class StaffInviteRead(StaffRead):
    """POST /staff/invite's response: the new staff row plus the link that
    lets them set a password. Returned to the owner as well as emailed,
    because email is optional (see app/email.py) and in practice a link
    sent over WhatsApp works just as well."""

    invite_link: str
    # Whether the API actually emailed it (false with no email address, or
    # email sending not set up) -- so the admin can say so honestly.
    email_sent: bool = False


class StaffUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    roles: list[StaffRole] | None = None
    # Single-role form, still accepted.
    role: StaffRole | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def _resolve_roles(self) -> "StaffUpdate":
        if self.roles is None and self.role is not None:
            self.roles = [self.role]
        if self.roles is not None:
            self.roles = _check_roles(self.roles)
        return self


# ---------- customers ----------


class CustomerBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    # Optional: a guest checkout only requires a name (see
    # app/routers/orders.py's checkout()) -- there's no account to need an
    # email for. Always present for a registered account, whose email is
    # its sign-in email (see POST /auth/signup).
    email: str | None = Field(default=None, min_length=3, max_length=320)
    phone: str | None = None
    customer_type: CustomerType = CustomerType.retail
    business_name: str | None = None
    tax_id: str | None = None
    notes: str | None = None


class CustomerCreate(CustomerBase):
    # Owner/order_fulfillment only (enforced by the route, same as every
    # other field here) -- defaults to 0, i.e. no credit buying until
    # someone deliberately grants a limit.
    credit_limit: float = Field(default=0, ge=0)


class CustomerUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = None
    business_name: str | None = None
    tax_id: str | None = None
    notes: str | None = None
    credit_limit: float | None = Field(default=None, ge=0)


class CustomerStatusUpdate(BaseModel):
    status: CustomerStatus


class CustomerRead(CustomerBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: CustomerStatus
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    credit_limit: float
    outstanding_balance: float
    is_wholesale_verified: bool
    created_at: datetime
    updated_at: datetime


# ---------- customer credit ledger ----------


class CustomerCreditPaymentCreate(BaseModel):
    amount: float = Field(gt=0)
    reason: str | None = None
    # How it was paid -- a cash repayment is expected in the drawer at
    # cash-up (see app/routers/cash_ups.py).
    method: Literal["cash", "mobile_money", "card"] = "cash"


class CustomerCreditAdjustmentCreate(BaseModel):
    """A manual correction (e.g. writing off a bad debt, or fixing a
    data-entry mistake) -- amount is signed: positive increases what the
    customer owes, negative decreases it. Distinct from
    CustomerCreditPaymentCreate, which is always a paydown and always
    positive input, to keep the common case (recording a payment) from
    needing staff to know about signs."""

    amount: float
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("amount")
    @classmethod
    def amount_not_zero(cls, value: float) -> float:
        if value == 0:
            raise ValueError("amount cannot be 0")
        return value


class CustomerCreditLedgerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    entry_type: CreditLedgerEntryType
    amount: float
    reason: str | None
    reference_type: str | None
    reference_id: uuid.UUID | None
    performed_by: uuid.UUID | None
    created_at: datetime
    method: PaymentMethod | None = None

    performed_by_name: str | None = None


class AgedDebtorRead(BaseModel):
    customer_id: uuid.UUID
    customer_name: str
    business_name: str | None
    outstanding_balance: float
    credit_limit: float
    oldest_unpaid_charge_at: datetime | None
    days_outstanding: int | None


# ---------- addresses ----------


class AddressBase(BaseModel):
    label: str = Field(default="Shipping", min_length=1, max_length=100)
    line1: str = Field(min_length=1, max_length=300)
    line2: str | None = None
    city: str = Field(min_length=1, max_length=200)
    state: str | None = None
    postal_code: str | None = None
    country: str = Field(min_length=1, max_length=100)
    is_default: bool = False


class AddressCreate(AddressBase):
    pass


class AddressRead(AddressBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


# ---------- orders ----------


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    variant_id: uuid.UUID
    quantity: int
    # What the customer paid each, online...
    unit_price: float
    line_total: float
    # ...and what it cost in store at the time (null for older orders).
    in_store_unit_price: float | None = None
    # Joined in from the variant/product (see OrderItem's properties in
    # app/models.py), so an order can be displayed without extra lookups.
    product_id: uuid.UUID
    product_name: str
    product_slug: str
    variant_sku: str
    variant_size: str
    variant_color: str | None
    variant_style: str | None
    image_storage_path: str | None


class OrderStatusHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: OrderStatus
    note: str | None
    created_at: datetime


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    order_number: str
    customer_id: uuid.UUID
    order_type: OrderType
    status: OrderStatus
    fulfillment_method: FulfillmentMethod
    subtotal: float
    discount_total: float
    tax_total: float
    shipping_total: float
    total: float
    notes: str | None
    created_at: datetime
    updated_at: datetime


class OrderWithItems(OrderRead):
    items: list[OrderItemRead] = []
    customer_name: str
    customer_email: str | None
    customer_phone: str | None
    shipping_address: AddressRead | None = None
    status_history: list[OrderStatusHistoryRead] = []


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    note: str | None = None


class CheckoutItem(BaseModel):
    variant_id: uuid.UUID
    quantity: int = Field(gt=0)


class CheckoutCreate(BaseModel):
    items: list[CheckoutItem] = Field(min_length=1)

    # Guest-only: ignored for a signed-in customer, who already has a
    # full_name/email on their `customers` row. Required if the request
    # carries no bearer token.
    guest_full_name: str | None = Field(default=None, min_length=1, max_length=200)
    guest_email: str | None = Field(default=None, min_length=3, max_length=320)
    guest_phone: str | None = None

    fulfillment_method: FulfillmentMethod = FulfillmentMethod.delivery

    # Shipping address: either an existing saved address (signed-in
    # customers only -- must belong to them) or a new one to create.
    # Required for fulfillment_method='delivery' only -- a pickup order
    # has nowhere to ship, so neither is needed (checked in the router,
    # not here, since "required" depends on another field's value).
    address_id: uuid.UUID | None = None
    address: AddressCreate | None = None

    notes: str | None = None


# ---------- device tokens ----------


class DeviceTokenRegister(BaseModel):
    platform: DevicePlatform
    token: str = Field(min_length=1, max_length=4096)


class DeviceTokenRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    platform: DevicePlatform
    token: str
    created_at: datetime


# ---------- back-in-stock notifications ----------


class StockNotificationRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    variant_id: uuid.UUID
    requested_at: datetime
    notified_at: datetime | None


# ---------- audit log ----------


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    staff_id: uuid.UUID | None
    action: str
    table_name: str
    record_id: uuid.UUID | None
    old_values: dict | None
    new_values: dict | None
    created_at: datetime

    staff_name: str | None = None


# ---------- dashboard ----------


class TierRevenue(BaseModel):
    price_tier: PriceTier
    items_sold: int
    revenue: float


class TopVariantRead(BaseModel):
    variant_id: uuid.UUID
    product_name: str
    size: str
    color: str | None
    style: str | None = None
    units_sold: int
    revenue: float


class DashboardRead(BaseModel):
    period_days: int
    gross_revenue: float
    items_sold: int
    revenue_by_tier: list[TierRevenue]
    top_variants: list[TopVariantRead]
    low_stock_count: int
    aged_debtors: list[AgedDebtorRead]
    total_outstanding_credit: float
    # All-time, not scoped to period_days -- this is a to-do count (how
    # many quick-logged sale lines still need a real product attached),
    # not a trend.
    unidentified_item_count: int


# ---------- sales reports & activity (app/routers/reports.py) ----------


class SalesTotals(BaseModel):
    revenue: float
    counter_revenue: float
    online_revenue: float
    receipts: int
    online_orders: int
    items_sold: int
    average_receipt: float
    # Counter takings split by how they were paid -- cash, mobile_money,
    # card, credit (on account). Online orders aren't paid through the till.
    by_method: dict[str, float]
    voided_count: int
    voided_amount: float
    # How much more online orders brought in than the same items would
    # have cost in store -- what the online markup earned.
    online_markup_earned: float
    # Money owed on account: new charges from credit sales in the period,
    # and payments received against balances in the period.
    credit_given: float
    credit_collected: float
    # Discounts given at the till (already taken off revenue), and on how
    # many receipts.
    discounts_given: float = 0
    discounted_receipts: int = 0
    # Money handed back for returned goods in the period (not taken off
    # revenue, which counts sales on the day they were made).
    refunds_given: float = 0
    returns_count: int = 0


class SalesPeriod(BaseModel):
    """One row of the tally: a day, week or month, in the shop's timezone."""

    start: date
    end: date
    receipts: int
    online_orders: int
    items_sold: int
    counter_revenue: float
    online_revenue: float
    revenue: float
    cash: float
    mobile_money: float
    card: float
    credit: float
    voided_count: int
    voided_amount: float


class ProductSales(BaseModel):
    """What sold. product_id/variant_id are null for quick-logged counter
    lines not yet matched to a product -- those are grouped by category."""

    product_id: uuid.UUID | None
    variant_id: uuid.UUID | None
    product_name: str
    sku: str | None
    size: str | None
    color: str | None
    style: str | None = None
    category_name: str | None
    quantity: int
    revenue: float
    counter_quantity: int
    online_quantity: int


class StaffSales(BaseModel):
    staff_id: uuid.UUID
    staff_name: str
    receipts: int
    items_sold: int
    revenue: float
    cash_taken: float
    # Sales this person rang up that were later voided (by anyone)...
    voided_count: int
    voided_amount: float
    # ...and voids this person carried out (of anyone's sales).
    voids_performed: int
    # Discounts this person gave on their (not voided) sales.
    discounts_given: float = 0


class CategorySales(BaseModel):
    category_name: str
    quantity: int
    revenue: float


class SalesReport(BaseModel):
    date_from: date
    date_to: date
    group_by: str
    timezone: str
    totals: SalesTotals
    periods: list[SalesPeriod]
    by_product: list[ProductSales]
    by_staff: list[StaffSales]
    by_category: list[CategorySales]


class ActivityRead(BaseModel):
    """One thing that happened, for the owner's activity log -- whatever
    its source table."""

    at: datetime
    kind: str  # sale | void | stock | catalog | order | credit | staff | deleted | cash_up
    staff_id: uuid.UUID | None
    staff_name: str | None
    summary: str
    detail: str | None = None
    amount: float | None = None
    reference_type: str | None = None
    reference_id: uuid.UUID | None = None


# ---------- shop settings (app/routers/settings.py) ----------


class ShopSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    online_markup_percent: float
    online_price_rounding: float
    updated_at: datetime


class ShopSettingsUpdate(BaseModel):
    online_markup_percent: float | None = Field(default=None, ge=0, le=200)
    # 0 = no rounding; otherwise online prices round *up* to a multiple of this.
    online_price_rounding: float | None = Field(default=None, ge=0, le=100)


# ---------- storefront content (app/routers/storefront.py) ----------
#
# What the admin's Website page edits and the website shows. Every field
# has a default -- the site's original wording -- so a stored document only
# needs the fields that were changed, and the site looks exactly as before
# until someone edits it. Lengths are capped so a slip of the keyboard
# can't break a page layout.

# Icons the selling points can use; the website maps each to a drawing.
HighlightIcon = Literal[
    "store", "truck", "boxes", "bell", "tag", "shield", "star", "clock", "card", "phone", "heart", "sparkles"
]


def _check_link(value: str | None) -> str | None:
    """Button links: a page on this site ("/shop", "/category/caps") or a
    full web address. Anything else (javascript:, typos) is refused."""
    if value is None or value == "":
        return value
    value = value.strip()
    if value.startswith("/") and not value.startswith("//"):
        return value
    if value.startswith(("https://", "http://")):
        return value
    raise ValueError("Links must be a page on the site (starting with /) or a full https:// address")


class StorefrontAnnouncement(BaseModel):
    """The thin strip above the header."""

    enabled: bool = True
    text: str = Field(default="Retail & wholesale menswear", max_length=120)
    # Shown after the text on wider screens only.
    extra: str = Field(default="Pick up in store or get it delivered", max_length=120)


class StorefrontHero(BaseModel):
    """The home page's opening banner."""

    eyebrow: str = Field(default="New season · Now in store", max_length=60)
    title: str = Field(default="Everyday menswear, stocked deep.", max_length=90)
    subtitle: str = Field(
        default="Caps, tees, jackets and the rest of the wardrobe — for the walk-in shopper and the business "
        "buying by the dozen.",
        max_length=300,
    )
    primary_label: str = Field(default="Shop new arrivals", max_length=40)
    primary_link: str = Field(default="/shop?sort=newest", max_length=300)
    # Leave the label empty to hide the second button.
    secondary_label: str = Field(default="Buying wholesale?", max_length=40)
    secondary_link: str = Field(default="/wholesale", max_length=300)
    # Up to three uploaded photos (storage paths, via POST
    # /uploads/product-photo). Empty: the newest products' photos.
    image_paths: list[str] = Field(default_factory=list, max_length=3)

    _links = field_validator("primary_link", "secondary_link")(_check_link)


class StorefrontHighlight(BaseModel):
    icon: HighlightIcon = "store"
    title: str = Field(max_length=40)
    text: str = Field(default="", max_length=80)


def _default_highlights() -> list[StorefrontHighlight]:
    return [
        StorefrontHighlight(icon="store", title="Pick up in store", text="Order online, collect at the shop"),
        StorefrontHighlight(icon="truck", title="Or get it delivered", text="We arrange delivery after you order"),
        StorefrontHighlight(icon="boxes", title="Wholesale pricing", text="Pack and bulk rates for businesses"),
        StorefrontHighlight(icon="bell", title="Back-in-stock alerts", text="Get notified when sizes return"),
    ]


class StorefrontFeatured(BaseModel):
    """A hand-picked row of products on the home page."""

    enabled: bool = False
    title: str = Field(default="Featured", max_length=60)
    subtitle: str = Field(default="", max_length=160)
    # In display order. Products that aren't live are skipped on the site.
    product_ids: list[uuid.UUID] = Field(default_factory=list, max_length=12)


class StorefrontPoint(BaseModel):
    title: str = Field(max_length=40)
    text: str = Field(default="", max_length=80)


def _default_wholesale_points() -> list[StorefrontPoint]:
    return [
        StorefrontPoint(title="Pack pricing", text="Factory-sealed packs at a better unit price"),
        StorefrontPoint(title="Bulk rates", text="Wholesale prices on loose units"),
        StorefrontPoint(title="Buy on account", text="Credit for approved businesses"),
        StorefrontPoint(title="One supplier", text="Caps to joggers in one order"),
    ]


class StorefrontWholesale(BaseModel):
    """The "For businesses" section at the bottom of the home page."""

    enabled: bool = True
    eyebrow: str = Field(default="For businesses", max_length=60)
    title: str = Field(default="Stocking your own shop?", max_length=90)
    text: str = Field(
        default="Approved wholesale customers get bulk and factory-pack pricing, and can buy on account. "
        "Tell us about your business and we'll set you up.",
        max_length=400,
    )
    button_label: str = Field(default="How wholesale works", max_length=40)
    button_link: str = Field(default="/wholesale", max_length=300)
    points: list[StorefrontPoint] = Field(default_factory=_default_wholesale_points, max_length=4)

    _links = field_validator("button_link")(_check_link)


class StorefrontContact(BaseModel):
    """Shown in the footer and on the wholesale page. Empty fields are left
    out (the website falls back to its build-time contact settings)."""

    phone: str = Field(default="", max_length=40)
    whatsapp: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=300)


class StorefrontSocial(BaseModel):
    """Full addresses of the shop's social pages; empty ones are hidden."""

    instagram: str = Field(default="", max_length=300)
    facebook: str = Field(default="", max_length=300)
    tiktok: str = Field(default="", max_length=300)
    x: str = Field(default="", max_length=300)

    @field_validator("instagram", "facebook", "tiktok", "x")
    @classmethod
    def _full_address(cls, value: str) -> str:
        value = value.strip()
        if value and not value.startswith(("https://", "http://")):
            raise ValueError("Social links must be full addresses, starting with https://")
        return value


class StorefrontPromo(BaseModel):
    """An optional promotional banner in the middle of the home page --
    a sale, new stock, a wholesale offer. Off until the shop has something
    real to say."""

    enabled: bool = False
    eyebrow: str = Field(default="This week", max_length=60)
    title: str = Field(default="", max_length=90)
    text: str = Field(default="", max_length=300)
    button_label: str = Field(default="Shop now", max_length=40)
    button_link: str = Field(default="/shop", max_length=300)
    # One uploaded photo (storage path), shown beside the words.
    image_path: str | None = Field(default=None, max_length=500)

    _links = field_validator("button_link")(_check_link)


# Ways the shop takes payment, shown on the "How to order" strip and in the
# footer.
PaymentMethodName = Literal["mobile_money", "cash", "card", "bank_transfer"]


class StorefrontVisit(BaseModel):
    """The "Visit the shop" section: where it is and when it's open. Shown
    only once there's something to show (an address, hours or a phone)."""

    enabled: bool = True
    title: str = Field(default="Visit the shop", max_length=60)
    text: str = Field(
        default="Come in to see the full range, try things on, and talk to us about wholesale.", max_length=300
    )
    # Free text, one line per day or range: "Mon–Sat: 8am – 7pm".
    hours: str = Field(default="", max_length=400)
    # A Google Maps (or similar) link for directions.
    map_link: str = Field(default="", max_length=500)

    @field_validator("map_link")
    @classmethod
    def _full_address(cls, value: str) -> str:
        value = value.strip()
        if value and not value.startswith(("https://", "http://")):
            raise ValueError("The map link must be a full address, starting with https://")
        return value


class StorefrontContent(BaseModel):
    """Everything the admin can change about the website's look and words.
    Unknown keys in a stored document are ignored, so removing a field
    later doesn't break reading old documents."""

    model_config = ConfigDict(extra="ignore")

    announcement: StorefrontAnnouncement = Field(default_factory=StorefrontAnnouncement)
    hero: StorefrontHero = Field(default_factory=StorefrontHero)
    highlights: list[StorefrontHighlight] = Field(default_factory=_default_highlights, max_length=4)
    show_categories: bool = True
    show_new_arrivals: bool = True
    featured: StorefrontFeatured = Field(default_factory=StorefrontFeatured)
    wholesale: StorefrontWholesale = Field(default_factory=StorefrontWholesale)
    footer_blurb: str = Field(
        default="Caps, tees, jackets and everyday menswear — for walk-in customers and for businesses "
        "buying wholesale.",
        max_length=300,
    )
    contact: StorefrontContact = Field(default_factory=StorefrontContact)
    social: StorefrontSocial = Field(default_factory=StorefrontSocial)
    promo: StorefrontPromo = Field(default_factory=StorefrontPromo)
    # The three-step "How to order" strip (browse, order, pickup/delivery).
    show_how_to_order: bool = True
    payment_methods: list[PaymentMethodName] = Field(default_factory=lambda: ["mobile_money", "cash", "card"])
    visit: StorefrontVisit = Field(default_factory=StorefrontVisit)


class StorefrontContentRead(BaseModel):
    """GET /storefront (admin): the content, and when/who last changed it."""

    content: StorefrontContent
    updated_at: datetime
    updated_by_name: str | None


class PublicStorefront(StorefrontContent):
    """GET /public/storefront: the content plus the featured products
    themselves (live ones only, at online prices, in the chosen order)."""

    featured_products: list[ProductWithVariants] = Field(default_factory=list)


# ---------- end-of-day cash-up (app/routers/cash_ups.py) ----------

# The ways money comes in that can be counted at the end of the day.
# 'credit' (on account) isn't money taken, so it's never counted.
CountedMethod = Literal["cash", "mobile_money", "card"]


class CashUpFigures(BaseModel):
    """What the till recorded for a day, which the count is checked
    against. Each by-method dict has cash, mobile_money and card (sales
    also has credit -- sold on account, so not in any drawer)."""

    receipts: int
    takings: float
    discounts: float
    voided_count: int
    sales_by_method: dict[str, float]
    # Wholesale customers paying off what they owe.
    repayments_by_method: dict[str, float]
    # Money handed back for returned goods.
    refunds_by_method: dict[str, float]
    # sales + repayments - refunds, per method: the money that should have
    # come in (the drawer's float and paid-out cash are added on top for
    # cash -- see CashUpRead.expected_cash).
    money_in: dict[str, float]


class CashUpCreate(BaseModel):
    business_date: date | None = None  # defaults to today, in the shop's timezone
    opening_float: float = Field(default=0, ge=0)
    paid_out: float = Field(default=0, ge=0)
    paid_out_note: str | None = Field(default=None, max_length=500)
    counted_cash: float = Field(ge=0)
    # Blank = not checked (no difference is worked out for it).
    counted_mobile_money: float | None = Field(default=None, ge=0)
    counted_card: float | None = Field(default=None, ge=0)
    left_in_drawer: float | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _sensible(self) -> "CashUpCreate":
        if self.paid_out > 0 and len((self.paid_out_note or "").strip()) < 3:
            raise ValueError("Say what the cash paid out was for")
        if self.left_in_drawer is not None and self.left_in_drawer > self.counted_cash + 0.001:
            raise ValueError("You can't leave more in the drawer than was counted")
        return self


class CashUpRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_date: date
    opening_float: float
    paid_out: float
    paid_out_note: str | None
    counted_cash: float
    counted_mobile_money: float | None
    counted_card: float | None
    expected_cash: float
    expected_mobile_money: float
    expected_card: float
    left_in_drawer: float | None
    note: str | None
    counted_by: uuid.UUID
    counted_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    # counted - expected: negative is a shortage, positive a surplus. None
    # where that method wasn't counted.
    cash_difference: float = 0
    mobile_money_difference: float | None = None
    card_difference: float | None = None
    # All the counted methods together.
    total_difference: float = 0


class CashUpDay(BaseModel):
    """Everything the cash-up screen needs for one day."""

    business_date: date
    # None until the day has been counted, for anyone but an owner: staff
    # count first and see what was expected afterwards (a "blind" count),
    # so the count isn't nudged towards the expected figure.
    figures: CashUpFigures | None
    # The float to start from: what the previous cash-up left in the drawer.
    suggested_opening_float: float
    cash_up: CashUpRead | None = None
    # True when the day's sales have changed since it was counted (e.g. a
    # sale voided or deleted afterwards), so the saved expected figures no
    # longer match the till.
    changed_since: bool = False
