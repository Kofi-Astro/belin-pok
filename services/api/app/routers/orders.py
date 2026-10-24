"""Storefront orders: guest/signed-in checkout, a customer's own order
history, and staff-side order management (listing, status updates, and
flagging orders that are short on stock after the fact). See
app/routers/pos_sales.py for the separate in-person register flow, which
uses its own POSSale model rather than Order."""

import uuid
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.deps import get_current_customer, get_current_staff, get_optional_customer, require_role
from app.erase import record_deletion, undo_stock
from app.models import (
    Address,
    Customer,
    CustomerDeviceToken,
    CustomerStatus,
    CustomerType,
    FulfillmentMethod,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
    OrderType,
    Product,
    ProductStatus,
    ProductVariant,
    Staff,
    StaffRole,
    StockMovement,
    StockMovementType,
)
from app.pricing import get_shop_settings, in_store_price, online_price
from app.push import send_push
from app.schemas import CheckoutCreate, OrderStatusUpdate, OrderWithItems
from app.shop_time import day_range

router = APIRouter(prefix="/orders", tags=["orders"])

# Everything OrderWithItems reads: each line's variant -> product -> photos
# (for its name/size/picture), plus the customer, delivery address and
# status history. Loaded up front with selectinload because async
# SQLAlchemy can't lazy-load a relationship on attribute access.
_ORDER_LOAD = (
    selectinload(Order.items)
    .selectinload(OrderItem.variant)
    .selectinload(ProductVariant.product)
    .selectinload(Product.images),
    selectinload(Order.customer),
    selectinload(Order.shipping_address),
    selectinload(Order.status_history),
)

_write_roles = require_role(StaffRole.owner, StaffRole.order_fulfillment)
_owner = require_role(StaffRole.owner)


# ---------- storefront checkout ----------
#
# GET /me is registered ahead of GET /{order_id} below for the same
# routing reason customers.py registers /register and /me first: Starlette
# matches route patterns in registration order, and "/{order_id}" would
# otherwise swallow "/me" as a (then invalid UUID) order_id and 422.


@router.post("/checkout", response_model=OrderWithItems, status_code=status.HTTP_201_CREATED)
async def checkout(
    payload: CheckoutCreate,
    db: AsyncSession = Depends(get_db),
    customer: Customer | None = Depends(get_optional_customer),
) -> Order:
    """Guest checkout (no account) or signed-in retail checkout, in one
    transaction: validate stock for every line, snapshot unit_price,
    create the order + order_items, and write an audited stock_movements
    'sale' row per line (same row-lock pattern as
    stock_movements.py's create_stock_movement, extended to every distinct
    variant in the cart so two checkouts racing for the last unit can't
    both succeed). No payment yet -- the order lands as status='pending'.
    """
    if customer is None:
        if not payload.guest_full_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="guest_full_name is required for guest checkout",
            )
        # A repeat guest checkout with the same email is normal -- most
        # repeat customers never create an account. Reuse the existing
        # customers row for that email as long as it's still a guest
        # (auth_user_id IS NULL); only a genuine registered account under
        # that email is a real conflict, since there's nothing to "sign in
        # instead" to for a guest who has no password. Skipped entirely
        # when no email was given -- there's nothing to look up by, and
        # each such guest just gets their own new row (see the nullable,
        # still-unique email column: Postgres treats multiple NULLs as
        # distinct, so this never collides).
        existing_customer = (
            await db.scalar(select(Customer).where(Customer.email == payload.guest_email))
            if payload.guest_email is not None
            else None
        )
        if existing_customer is not None:
            if existing_customer.auth_user_id is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A customer with this email already exists — sign in instead",
                )
            customer = existing_customer
        else:
            customer = Customer(
                full_name=payload.guest_full_name,
                email=payload.guest_email,
                phone=payload.guest_phone,
                customer_type=CustomerType.retail,
                status=CustomerStatus.approved,
            )
            db.add(customer)
            try:
                await db.flush()
            except IntegrityError as exc:
                await db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A customer with this email already exists — sign in instead",
                ) from exc

    # A pickup order has nowhere to ship, so it's the one case where
    # neither address_id nor address is required -- shipping_address_id
    # stays null, same as it always could, but now fulfillment_method
    # records *why* rather than leaving that ambiguous.
    address = None
    if payload.fulfillment_method == FulfillmentMethod.delivery:
        if payload.address_id is not None:
            address = await db.get(Address, payload.address_id)
            if address is None or address.customer_id != customer.id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Address not found")
        elif payload.address is not None:
            address = Address(customer_id=customer.id, **payload.address.model_dump())
            db.add(address)
            await db.flush()
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="address or address_id is required for delivery",
            )

    # Merge duplicate lines for the same variant first -- otherwise two
    # lines of the same variant would each pass a per-line stock check
    # independently even though their combined demand exceeds stock.
    quantities: dict[uuid.UUID, int] = {}
    for item in payload.items:
        quantities[item.variant_id] = quantities.get(item.variant_id, 0) + item.quantity

    # Lock every distinct variant row up front, in a fixed (sorted) order,
    # before reading any stock_quantity -- this is what makes two
    # concurrent checkouts racing for the same variant(s) serialize
    # instead of deadlock or both succeed past zero stock.
    variants: dict[uuid.UUID, ProductVariant] = {}
    for variant_id in sorted(quantities):
        variant = await db.scalar(select(ProductVariant).where(ProductVariant.id == variant_id).with_for_update())
        if variant is None or not variant.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Variant {variant_id} not found or unavailable"
            )
        variants[variant_id] = variant

    products: dict[uuid.UUID, Product] = {}
    settings = await get_shop_settings(db)
    subtotal = 0.0
    line_items: list[tuple[ProductVariant, int, float, float]] = []
    for variant_id, quantity in quantities.items():
        variant = variants[variant_id]
        product = products.get(variant.product_id) or await db.get(Product, variant.product_id)
        products[variant.product_id] = product
        if product is None or product.status != ProductStatus.active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=f"Product for variant {variant_id} is no longer available"
            )
        if variant.stock_quantity < quantity:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Only {variant.stock_quantity} left in stock for SKU {variant.sku}",
            )
        # Orders placed online pay the online price (see app/pricing.py);
        # the in-store price is kept beside it on the order line.
        unit_price = online_price(product, variant, settings)
        subtotal += float(unit_price) * quantity
        line_items.append((variant, quantity, unit_price, in_store_price(product, variant)))

    order = Order(
        customer_id=customer.id,
        order_type=OrderType.retail,
        status=OrderStatus.pending,
        fulfillment_method=payload.fulfillment_method,
        subtotal=subtotal,
        total=subtotal,
        shipping_address_id=address.id if address is not None else None,
        notes=payload.notes,
    )
    db.add(order)
    await db.flush()

    for variant, quantity, unit_price, store_price in line_items:
        db.add(
            OrderItem(
                order_id=order.id,
                variant_id=variant.id,
                quantity=quantity,
                unit_price=unit_price,
                in_store_unit_price=store_price,
            )
        )
        db.add(
            StockMovement(
                variant_id=variant.id,
                movement_type=StockMovementType.sale,
                quantity_change=-quantity,
                reference_type="order",
                reference_id=order.id,
                performed_by=None,
            )
        )

    await db.commit()

    # populate_existing: this order is already in the session from
    # earlier in the request, and its lines were added after it was loaded.
    stmt = select(Order).where(Order.id == order.id).options(*_ORDER_LOAD).execution_options(populate_existing=True)
    return await db.scalar(stmt)


@router.get("/me", response_model=list[OrderWithItems])
async def list_my_orders(
    customer: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> list[Order]:
    stmt = select(Order).where(Order.customer_id == customer.id).options(*_ORDER_LOAD).order_by(Order.created_at.desc())
    result = await db.scalars(stmt)
    return list(result)


# ---------- staff ----------


@router.get("", response_model=list[OrderWithItems], dependencies=[Depends(get_current_staff)])
async def list_orders(
    response: Response,
    db: AsyncSession = Depends(get_db),
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    customer_id: uuid.UUID | None = None,
    search: str | None = Query(default=None, min_length=1, max_length=200),
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Order]:
    """Newest first. `search` matches the order number or the customer's
    name, email or phone. X-Total-Count carries the number of matches."""
    stmt = select(Order)
    if date_from or date_to:
        # Whole days in the shop's timezone, like the sales journal.
        start, end = day_range(date_from or date(2000, 1, 1), date_to or date(2100, 1, 1))
        stmt = stmt.where(Order.created_at >= start, Order.created_at < end)
    if status_filter is not None:
        stmt = stmt.where(Order.status == status_filter)
    if customer_id is not None:
        stmt = stmt.where(Order.customer_id == customer_id)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.join(Customer, Customer.id == Order.customer_id).where(
            or_(
                Order.order_number.ilike(pattern),
                Customer.full_name.ilike(pattern),
                Customer.email.ilike(pattern),
                Customer.phone.ilike(pattern),
            )
        )
    response.headers["X-Total-Count"] = str(await db.scalar(select(func.count()).select_from(stmt.subquery())))
    result = await db.scalars(stmt.options(*_ORDER_LOAD).order_by(Order.created_at.desc()).limit(limit).offset(offset))
    return list(result)


@router.get("/needs-attention", response_model=list[OrderWithItems], dependencies=[Depends(get_current_staff)])
async def orders_needing_attention(db: AsyncSession = Depends(get_db)) -> list[Order]:
    """Not-yet-fulfilled orders where the database no longer has enough of
    something to cover what was ordered. This isn't the checkout race the
    row locks in checkout()/create_stock_movement() already prevent --
    it's the gap that opens up *after* an order is placed, almost always
    because a walk-in sale at the counter reduced the physical stock
    without a matching stock movement ever being logged, so the database
    still thinks there's enough. Scoped to pending/paid: once an order is
    packed, staff have already physically confirmed the item, so it's no
    longer "at risk" in this sense even if the count here would still
    flag it.
    """
    at_risk_order_ids = (
        select(OrderItem.order_id)
        .join(ProductVariant, ProductVariant.id == OrderItem.variant_id)
        .where(ProductVariant.stock_quantity < OrderItem.quantity)
        .distinct()
    )
    stmt = (
        select(Order)
        .where(Order.status.in_([OrderStatus.pending, OrderStatus.paid]))
        .where(Order.id.in_(at_risk_order_ids))
        .options(*_ORDER_LOAD)
        .order_by(Order.created_at.desc())
    )
    result = await db.scalars(stmt)
    return list(result)


@router.get("/{order_id}", response_model=OrderWithItems, dependencies=[Depends(get_current_staff)])
async def get_order(order_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Order:
    stmt = select(Order).where(Order.id == order_id).options(*_ORDER_LOAD)
    order = await db.scalar(stmt)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


@router.post("/{order_id}/status", response_model=OrderWithItems)
async def update_order_status(
    order_id: uuid.UUID,
    payload: OrderStatusUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_write_roles),
) -> Order:
    order = await db.scalar(select(Order).where(Order.id == order_id).options(selectinload(Order.items)))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    await _sync_order_stock(db, order, order.status, payload.status, staff)
    order.status = payload.status
    db.add(OrderStatusHistory(order_id=order.id, status=payload.status, changed_by=staff.id, note=payload.note))

    await db.commit()

    # Best-effort: scheduled with BackgroundTasks so it runs after this
    # response is sent, and can never fail or roll back the status update
    # above, which has already committed by this point.
    tokens = await db.scalars(
        select(CustomerDeviceToken.token).where(CustomerDeviceToken.customer_id == order.customer_id)
    )
    token_list = list(tokens)
    if token_list:
        background_tasks.add_task(
            send_push,
            token_list,
            "Order update",
            f"Your order #{order.order_number} is now {payload.status.value}.",
        )

    # populate_existing: status_history just gained a row in this session.
    stmt = select(Order).where(Order.id == order_id).options(*_ORDER_LOAD).execution_options(populate_existing=True)
    return await db.scalar(stmt)


# An order takes its stock at checkout (movements with reference_type
# "order"). Closing it gives the stock back with "order_cancel" movements,
# and reopening it takes it again -- so the net of an order's movements is
# always what it's currently holding off the shelf.
_CLOSED = {OrderStatus.cancelled, OrderStatus.refunded}
# Until an order has been shipped its goods are still in the shop; after
# that, a refund doesn't bring them back by itself -- when they're actually
# returned, that's recorded as a customer return (Adjust stock).
_STILL_IN_SHOP = {OrderStatus.pending, OrderStatus.paid, OrderStatus.packed}


async def _sync_order_stock(db: AsyncSession, order: Order, old: OrderStatus, new: OrderStatus, staff: Staff) -> None:
    """Returns an order's stock to the shelf when it's cancelled (or refunded
    before shipping), and takes it again if a closed order is reopened --
    refusing, with a clear message, if there's no longer enough."""
    held: dict[uuid.UUID, int] = {}
    for m in await db.scalars(
        select(StockMovement).where(
            StockMovement.reference_type.in_(["order", "order_cancel"]), StockMovement.reference_id == order.id
        )
    ):
        held[m.variant_id] = held.get(m.variant_id, 0) - m.quantity_change

    gives_back = new in _CLOSED and old not in _CLOSED and (new == OrderStatus.cancelled or old in _STILL_IN_SHOP)
    if gives_back:
        for variant_id, quantity in held.items():
            if quantity > 0:
                db.add(
                    StockMovement(
                        variant_id=variant_id,
                        movement_type=StockMovementType.return_,
                        quantity_change=quantity,
                        reason=f"Online order {order.order_number} {new.value}",
                        reference_type="order_cancel",
                        reference_id=order.id,
                        performed_by=staff.id,
                    )
                )
        return

    if old in _CLOSED and new not in _CLOSED:
        # Reopened: take back whatever isn't currently held.
        wanted: dict[uuid.UUID, int] = {}
        for item in order.items:
            wanted[item.variant_id] = wanted.get(item.variant_id, 0) + item.quantity
        for variant_id in sorted(wanted):
            missing = wanted[variant_id] - held.get(variant_id, 0)
            if missing <= 0:
                continue
            variant = await db.scalar(select(ProductVariant).where(ProductVariant.id == variant_id).with_for_update())
            if variant.stock_quantity < missing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Can't reopen: SKU {variant.sku} only has {variant.stock_quantity} in stock, needs {missing}"
                    ),
                )
            db.add(
                StockMovement(
                    variant_id=variant_id,
                    movement_type=StockMovementType.sale,
                    quantity_change=-missing,
                    reason=f"Online order {order.order_number} reopened",
                    reference_type="order",
                    reference_id=order.id,
                    performed_by=staff.id,
                )
            )


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_order(
    order_id: uuid.UUID,
    reason: str = Query(min_length=3, max_length=500),
    db: AsyncSession = Depends(get_db),
    staff: Staff = Depends(_owner),
) -> None:
    """Deletes an online order outright -- owner only, for test orders and
    junk (see app/erase.py). The stock it took comes back, it disappears
    from the orders list and the reports, and an audit entry records who
    deleted it, why, and what it was. The customer record stays (delete it
    separately if it was a test customer too).
    """
    order = await db.scalar(select(Order).where(Order.id == order_id).options(*_ORDER_LOAD))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    lines = ", ".join(
        f"{i.variant.product.name} ({' · '.join(filter(None, [i.variant.style, i.variant.size]))}) ×{i.quantity}"
        for i in order.items
        if i.variant is not None
    )

    # Its checkout movements, and any given back by cancelling it.
    await undo_stock(db, ["order", "order_cancel"], order.id)
    record_deletion(
        db,
        staff,
        action="order.delete",
        table_name="orders",
        record_id=order.id,
        reason=reason.strip(),
        what={
            "summary": f"online order {order.order_number} (₵{float(order.total):.2f}) from {order.customer.full_name}",
            "lines": lines,
            "status": order.status.value,
            "placed_at": order.created_at.isoformat(),
            "amount": float(order.total),
        },
    )
    # Lines and status history go with it (ON DELETE CASCADE).
    await db.execute(delete(Order).where(Order.id == order.id))
    await db.commit()
