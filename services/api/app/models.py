import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    FetchedValue,
    ForeignKey,
    Numeric,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db import Base

# These tables/types/functions/policies already exist via supabase/migrations/.
# SQLAlchemy models below map onto that schema -- they never issue DDL
# themselves (no create_all in this app; migrations are the source of
# truth), so every enum below is declared with create_type=False.


class StaffRole(enum.StrEnum):
    """Who can do what in the admin app -- see app/deps.py's require_role()."""

    owner = "owner"
    inventory_manager = "inventory_manager"
    order_fulfillment = "order_fulfillment"
    viewer = "viewer"


class ProductStatus(enum.StrEnum):
    """draft/archived products are hidden from the public storefront catalog
    (see app/routers/public.py); only 'active' products are customer-facing."""

    draft = "draft"
    active = "active"
    archived = "archived"


class CustomerType(enum.StrEnum):
    """Wholesale customers get pack/wholesale pricing tiers and a credit
    ledger; retail customers pay standard prices with no credit."""

    retail = "retail"
    wholesale = "wholesale"


class CustomerStatus(enum.StrEnum):
    """Only relevant for wholesale sign-ups, which need staff approval
    before they're treated as verified (see Customer.is_wholesale_verified
    below). Retail customers default straight to approved."""

    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class OrderType(enum.StrEnum):
    """Retail orders come from the public storefront or a retail POS sale;
    wholesale orders get wholesale/pack pricing and can draw on credit."""

    retail = "retail"
    wholesale = "wholesale"


class OrderStatus(enum.StrEnum):
    """The order fulfillment lifecycle, tracked in order_status_history as
    it progresses."""

    pending = "pending"
    paid = "paid"
    packed = "packed"
    shipped = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"
    refunded = "refunded"


class StockMovementType(enum.StrEnum):
    """Every change to a variant's stock_quantity is recorded as one of
    these -- stock_movements is the append-only ledger, never just an
    in-place quantity update (see StockMovement below)."""

    restock = "restock"
    sale = "sale"
    adjustment = "adjustment"
    return_ = "return"
    initial = "initial"


class DevicePlatform(enum.StrEnum):
    """Which push-notification channel a CustomerDeviceToken belongs to."""

    ios = "ios"
    android = "android"


class FulfillmentMethod(enum.StrEnum):
    """How an order reaches the customer -- gates whether Order needs a
    shipping_address_id (see Order below)."""

    delivery = "delivery"
    pickup = "pickup"


class PaymentMethod(enum.StrEnum):
    """How a POS sale was paid -- 'credit' draws down a wholesale
    customer's credit_limit instead of being collected on the spot."""

    cash = "cash"
    mobile_money = "mobile_money"
    card = "card"
    credit = "credit"


class PriceTier(enum.StrEnum):
    """Which of a variant's several prices (base_price/wholesale_price/
    pack_price) a POS sale line was actually billed at."""

    retail = "retail"
    wholesale = "wholesale"
    pack = "pack"


class CreditLedgerEntryType(enum.StrEnum):
    """charge increases a wholesale customer's outstanding_balance (a
    credit sale), payment decreases it, adjustment is a manual correction."""

    charge = "charge"
    payment = "payment"
    adjustment = "adjustment"


def _pg_enum(pg_enum: enum.EnumMeta, name: str) -> PgEnum:
    return PgEnum(pg_enum, name=name, create_type=False)


class Staff(Base):
    """An admin-app user -- the staff equivalent of Customer. Rows are
    created by Supabase Auth invitation (see app/supabase_admin.py), not
    self-registration."""

    __tablename__ = "staff"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    email: Mapped[str] = mapped_column(unique=True)
    full_name: Mapped[str]
    role: Mapped[StaffRole] = mapped_column(_pg_enum(StaffRole, "staff_role"), default=StaffRole.viewer)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Category(Base):
    """A product category (Caps, T-Shirts, ...). Self-referential via
    parent_id for optional sub-categories; name is only unique per-parent,
    not globally."""

    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str]
    slug: Mapped[str] = mapped_column(unique=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    description: Mapped[str | None]
    display_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (UniqueConstraint("parent_id", "name"),)


class Supplier(Base):
    """Who a product is sourced from -- purely informational (contact
    details, notes); not involved in stock or pricing logic."""

    __tablename__ = "suppliers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str]
    contact_name: Mapped[str | None]
    email: Mapped[str | None]
    phone: Mapped[str | None]
    address: Mapped[str | None]
    notes: Mapped[str | None]
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Product(Base):
    """A sellable item, e.g. "Classic Snapback Cap". base_price is the
    default retail price; actual variants (size/color) can override it --
    see ProductVariant below. Only 'active' status products are visible on
    the public storefront."""

    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str]
    slug: Mapped[str] = mapped_column(unique=True)
    description: Mapped[str | None]
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    brand: Mapped[str | None]
    base_price: Mapped[float] = mapped_column(Numeric(10, 2))
    status: Mapped[ProductStatus] = mapped_column(
        _pg_enum(ProductStatus, "product_status"), default=ProductStatus.draft
    )
    primary_supplier_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (CheckConstraint("base_price >= 0"),)

    category: Mapped["Category"] = relationship(lazy="joined")
    variants: Mapped[list["ProductVariant"]] = relationship(back_populates="product", cascade="all, delete-orphan")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product", cascade="all, delete-orphan", order_by="ProductImage.display_order"
    )


class ProductVariant(Base):
    """One purchasable size/color combination of a Product -- this is what
    actually carries stock_quantity and a SKU, not the Product itself.
    price_override/wholesale_price/pack_price are optional per-variant
    overrides of the product's base_price for each PriceTier."""

    __tablename__ = "product_variants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    sku: Mapped[str] = mapped_column(unique=True)
    size: Mapped[str]
    color: Mapped[str | None]
    color_hex: Mapped[str | None]
    price_override: Mapped[float | None] = mapped_column(Numeric(10, 2))
    wholesale_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    pack_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    pack_size: Mapped[int | None]
    stock_quantity: Mapped[int] = mapped_column(default=0)
    low_stock_threshold: Mapped[int] = mapped_column(default=5)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (UniqueConstraint("product_id", "size", "color"),)

    product: Mapped["Product"] = relationship(back_populates="variants")


class ProductImage(Base):
    """A photo attached to a Product, optionally scoped to one specific
    variant (e.g. a color-specific shot). storage_path points into Supabase
    Storage, not a URL stored directly."""

    __tablename__ = "product_images"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    variant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"))
    storage_path: Mapped[str]
    alt_text: Mapped[str | None]
    display_order: Mapped[int] = mapped_column(default=0)
    is_primary: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    product: Mapped["Product"] = relationship(back_populates="images")


class StockMovement(Base):
    """One append-only ledger entry for a change to a variant's stock --
    never delete or edit a row here; corrections are a new offsetting
    movement. quantity_change is signed (positive for restock/return,
    negative for sale)."""

    __tablename__ = "stock_movements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"))
    movement_type: Mapped[StockMovementType] = mapped_column(_pg_enum(StockMovementType, "stock_movement_type"))
    quantity_change: Mapped[int]
    reason: Mapped[str | None]
    reference_type: Mapped[str | None]
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # Nullable: a storefront checkout's 'sale' movements have no staff
    # member behind them (see supabase/migrations). reference_type/
    # reference_id carry the traceability in that case instead.
    performed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class POSSale(Base):
    """An in-person checkout transaction: what groups the several
    stock_movements one register sale produces (one customer, several
    different items, one payment) -- see supabase/migrations for why the
    line items themselves live in stock_movements rather than a second
    table here."""

    __tablename__ = "pos_sales"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="SET NULL"))
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(default="completed")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    payments: Mapped[list["POSSalePayment"]] = relationship(back_populates="sale", cascade="all, delete-orphan")
    items: Mapped[list["POSSaleItem"]] = relationship(back_populates="sale", cascade="all, delete-orphan")


class POSSalePayment(Base):
    """One payment applied to a POSSale -- a single sale can be split
    across multiple methods (e.g. part cash, part mobile money)."""

    __tablename__ = "pos_sale_payments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pos_sales.id", ondelete="CASCADE"))
    method: Mapped[PaymentMethod] = mapped_column(_pg_enum(PaymentMethod, "payment_method"))
    amount: Mapped[float] = mapped_column(Numeric(10, 2))

    sale: Mapped["POSSale"] = relationship(back_populates="payments")


class POSSaleItem(Base):
    """Snapshot of what a POS sale line was actually billed at -- see
    supabase/migrations/20260817120010_pos_sale_items.sql for why this
    exists as its own table rather than being inferred from
    stock_movements the way it used to be.

    variant_id is nullable: a "quick log" line (see
    supabase/migrations/20260820120001_pos_sale_items_quick_log.sql)
    records category_id + a staff-entered unit_price for a sale rung up by
    product type when there's no time to hunt down the exact SKU by hand.
    No stock_movement exists for it until a variant is attached via the
    identify endpoint in app/routers/pos_sales.py -- until then it counts
    for revenue/audit purposes but not for stock.
    """

    __tablename__ = "pos_sale_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pos_sales.id", ondelete="CASCADE"))
    variant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"))
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    note: Mapped[str | None]
    price_tier: Mapped[PriceTier] = mapped_column(_pg_enum(PriceTier, "price_tier"), default=PriceTier.retail)
    quantity: Mapped[int]
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2))
    line_total: Mapped[float] = mapped_column(Numeric(10, 2), server_default=FetchedValue())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    sale: Mapped["POSSale"] = relationship(back_populates="items")


class Customer(Base):
    """A storefront/POS customer -- the customer equivalent of Staff.
    auth_user_id links to a Supabase Auth user for customers who created an
    online account; it's nullable because POS can also record a walk-in
    customer with no login at all."""

    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    auth_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), unique=True)
    full_name: Mapped[str]
    email: Mapped[str] = mapped_column(unique=True)
    phone: Mapped[str | None]
    customer_type: Mapped[CustomerType] = mapped_column(
        _pg_enum(CustomerType, "customer_type"), default=CustomerType.retail
    )
    status: Mapped[CustomerStatus] = mapped_column(
        _pg_enum(CustomerStatus, "customer_status"), default=CustomerStatus.approved
    )
    business_name: Mapped[str | None]
    tax_id: Mapped[str | None]
    notes: Mapped[str | None]
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None]
    credit_limit: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    outstanding_balance: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    @property
    def is_wholesale_verified(self) -> bool:
        """True once a wholesale sign-up has been staff-approved -- gates
        access to wholesale/pack pricing and credit sales."""
        return self.customer_type == CustomerType.wholesale and self.status == CustomerStatus.approved


class Address(Base):
    """A saved shipping/billing address for a Customer. A customer can have
    several; is_default marks which one pre-fills checkout."""

    __tablename__ = "addresses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(default="Shipping")
    line1: Mapped[str]
    line2: Mapped[str | None]
    city: Mapped[str]
    state: Mapped[str | None]
    postal_code: Mapped[str | None]
    country: Mapped[str]
    is_default: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Order(Base):
    """An order placed through the storefront (guest or signed-in
    customer). The wholesale/retail POS instead records a POSSale --
    orders and POS sales are separate flows that both draw down the same
    ProductVariant.stock_quantity."""

    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # order_number's actual default (ORD-YYYYMMDD-NNNNN from a sequence) is
    # a DB-side DEFAULT expression, not something this model replicates in
    # Python -- server_default=FetchedValue() tells SQLAlchemy a server
    # default exists without saying what it is, so it omits the column
    # from INSERTs (letting Postgres apply it) instead of sending an
    # explicit NULL, which no order-creating route hit until checkout.
    order_number: Mapped[str] = mapped_column(unique=True, server_default=FetchedValue())
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"))
    order_type: Mapped[OrderType] = mapped_column(_pg_enum(OrderType, "order_type"), default=OrderType.retail)
    status: Mapped[OrderStatus] = mapped_column(_pg_enum(OrderStatus, "order_status"), default=OrderStatus.pending)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    discount_total: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    tax_total: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    shipping_total: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    total: Mapped[float] = mapped_column(Numeric(10, 2))
    shipping_address_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("addresses.id", ondelete="SET NULL"))
    billing_address_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("addresses.id", ondelete="SET NULL"))
    # Explicit, not inferred from shipping_address_id being null -- that's
    # ambiguous between "picking up in person" and "address never got
    # recorded". Default 'delivery' keeps every pre-existing order (and
    # every pre-existing test) correct without a backfill.
    fulfillment_method: Mapped[FulfillmentMethod] = mapped_column(
        _pg_enum(FulfillmentMethod, "fulfillment_method"), default=FulfillmentMethod.delivery
    )
    notes: Mapped[str | None]
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    """One line item of an Order -- a quantity of a specific
    ProductVariant at the price it was sold for (unit_price is a snapshot,
    independent of the variant's current price)."""

    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"))
    quantity: Mapped[int]
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2))
    # `generated always as (quantity * unit_price) stored` in the
    # migration -- Postgres computes this and rejects any explicit value
    # (NULL included), so this needs the same FetchedValue() treatment as
    # Order.order_number above, for the same reason: no route constructed
    # an OrderItem via the ORM until checkout, so this never got exercised.
    line_total: Mapped[float] = mapped_column(Numeric(10, 2), server_default=FetchedValue())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    order: Mapped["Order"] = relationship(back_populates="items")


class OrderStatusHistory(Base):
    """Append-only audit trail of an Order's status changes -- one row per
    transition, written alongside (not instead of) updating Order.status."""

    __tablename__ = "order_status_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    status: Mapped[OrderStatus] = mapped_column(_pg_enum(OrderStatus, "order_status"))
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id", ondelete="SET NULL"))
    note: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CustomerDeviceToken(Base):
    """A mobile push-notification token registered by a signed-in
    customer's device -- see app/push.py for how these get used, and
    app/routers/device_tokens.py for registration."""

    __tablename__ = "customer_device_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    platform: Mapped[DevicePlatform] = mapped_column(_pg_enum(DevicePlatform, "device_platform"))
    token: Mapped[str] = mapped_column(unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class StockNotificationRequest(Base):
    """A customer's "notify me when this is back in stock" request for one
    variant. notified_at is set once the notification has actually been
    sent, so the same request isn't fired twice."""

    __tablename__ = "stock_notification_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"))
    requested_at: Mapped[datetime] = mapped_column(server_default=func.now())
    notified_at: Mapped[datetime | None]


class AuditLog(Base):
    """Generic before/after audit trail for admin-app writes (who changed
    what row in what table, and what it looked like before/after) --
    broader and less structured than OrderStatusHistory or
    CustomerCreditLedger, which are purpose-built ledgers for one thing
    each."""

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    staff_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id", ondelete="SET NULL"))
    action: Mapped[str]
    table_name: Mapped[str]
    record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    old_values: Mapped[dict | None] = mapped_column(JSONB)
    new_values: Mapped[dict | None] = mapped_column(JSONB)
    ip_address: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CustomerCreditLedger(Base):
    """Append-only history of every change to a wholesale customer's
    outstanding_balance -- see supabase/migrations/
    20260817120007_customer_credit_ledger.sql. Never updated or deleted;
    corrections are offsetting rows, same as stock_movements."""

    __tablename__ = "customer_credit_ledger"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"))
    entry_type: Mapped[CreditLedgerEntryType] = mapped_column(
        _pg_enum(CreditLedgerEntryType, "credit_ledger_entry_type")
    )
    amount: Mapped[float] = mapped_column(Numeric(10, 2))
    reason: Mapped[str | None]
    reference_type: Mapped[str | None]
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    performed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
