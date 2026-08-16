import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import CustomerStatus, CustomerType, OrderStatus, OrderType, ProductStatus, StaffRole, StockMovementType


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
    sku: str = Field(min_length=1, max_length=100)
    size: str = Field(min_length=1, max_length=50)
    color: str | None = None
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    price_override: float | None = Field(default=None, ge=0)
    low_stock_threshold: int = Field(default=5, ge=0)
    is_active: bool = True


class ProductVariantCreate(ProductVariantBase):
    pass


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
    stock_quantity: int
    created_at: datetime
    updated_at: datetime


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
    performed_by: uuid.UUID
    created_at: datetime


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
