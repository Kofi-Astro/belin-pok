import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import (
    CustomerStatus,
    CustomerType,
    DevicePlatform,
    FulfillmentMethod,
    OrderStatus,
    OrderType,
    ProductStatus,
    StaffRole,
    StockMovementType,
)


class HealthResponse(BaseModel):
    status: str = "ok"


# ---------- categories ----------


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=200, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    parent_id: uuid.UUID | None = None
    description: str | None = None
    display_order: int = 0


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=200, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    parent_id: uuid.UUID | None = None
    description: str | None = None
    display_order: int | None = None


class CategoryRead(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


# ---------- product variants ----------


class ProductVariantBase(BaseModel):
    size: str = Field(min_length=1, max_length=50)
    color: str | None = None
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    price_override: float | None = Field(default=None, ge=0)
    low_stock_threshold: int = Field(default=5, ge=0)
    is_active: bool = True


class ProductVariantCreate(ProductVariantBase):
    # Optional: POST /products/{id}/variants auto-generates one from the
    # product's slug + size + color when omitted, so nobody has to invent
    # a unique code by hand. Still overridable for the rare case a real
    # SKU (e.g. from a supplier) needs to be used instead.
    sku: str | None = Field(default=None, min_length=1, max_length=100)


class ProductVariantUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    size: str | None = Field(default=None, min_length=1, max_length=50)
    color: str | None = None
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    price_override: float | None = Field(default=None, ge=0)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


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
    performed_by_name: str | None = None
    performed_by_role: StaffRole | None = None
    unit_price: float | None = None


class DailySalesRead(BaseModel):
    day: date
    items_sold: int
    total_amount: float


# ---------- staff ----------


class StaffRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    role: StaffRole
    is_active: bool
    created_at: datetime


class StaffInvite(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    full_name: str = Field(min_length=1, max_length=200)
    role: StaffRole = StaffRole.viewer


class StaffUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    role: StaffRole | None = None
    is_active: bool | None = None


# ---------- customers ----------


class CustomerBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = None
    customer_type: CustomerType = CustomerType.retail
    business_name: str | None = None
    tax_id: str | None = None
    notes: str | None = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = None
    business_name: str | None = None
    tax_id: str | None = None
    notes: str | None = None


class CustomerStatusUpdate(BaseModel):
    status: CustomerStatus


class CustomerRead(CustomerBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: CustomerStatus
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CustomerRegister(BaseModel):
    """Storefront self-registration. Distinct from CustomerCreate (which
    POST /customers, a staff-only endpoint, uses): email comes from the
    caller's own verified Supabase Auth token rather than a body field (so
    a customer can't register using someone else's email), and there's no
    way to pick customer_type or status -- self-registration is always
    customer_type='retail', status='approved'. Wholesale signup isn't part
    of this phase; wholesale accounts are still staff-created via
    POST /customers.
    """

    full_name: str = Field(min_length=1, max_length=200)
    phone: str | None = None


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
    unit_price: float
    line_total: float


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
