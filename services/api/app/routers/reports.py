from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_role
from app.models import (
    CreditLedgerEntryType,
    Customer,
    CustomerCreditLedger,
    Order,
    OrderItem,
    OrderStatus,
    POSSale,
    POSSaleItem,
    PriceTier,
    Product,
    ProductVariant,
    Staff,
    StaffRole,
)
from app.schemas import (
    AgedDebtorRead,
    DailySalesRead,
    DashboardRead,
    TierRevenue,
    TopVariantRead,
)

router = APIRouter(prefix="/reports", tags=["reports"])

_read_roles = require_role(StaffRole.owner, StaffRole.inventory_manager)

# Orders never actually get cancelled/refunded stock back through this
# path (that's still a manual stock_movements correction), but a
# cancelled/refunded order was never real revenue either way, so both are
# excluded from every report below.
_COUNTED_ORDER_STATUSES = (
    OrderStatus.pending,
    OrderStatus.paid,
    OrderStatus.packed,
    OrderStatus.shipped,
    OrderStatus.delivered,
)


@router.get("/daily-sales", response_model=list[DailySalesRead])
async def daily_sales(
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_read_roles),
    days: int = Query(default=30, ge=1, le=365),
) -> list[DailySalesRead]:
    """One row per day with at least one sale, newest first, combining POS
    sales and storefront orders -- both snapshot unit_price at the moment
    of sale (see supabase/migrations/20260817120010_pos_sale_items.sql for
    why POS sales didn't used to), so this is exact even if prices have
    since changed.
    """
    pos_day = func.date(POSSale.created_at)
    pos_stmt = (
        select(
            pos_day.label("day"),
            func.sum(POSSaleItem.quantity).label("items_sold"),
            func.sum(POSSaleItem.line_total).label("total_amount"),
        )
        .select_from(POSSaleItem)
        .join(POSSale, POSSale.id == POSSaleItem.sale_id)
        .where(POSSale.status != "voided")
        .group_by(pos_day)
    )
    order_day = func.date(Order.created_at)
    order_stmt = (
        select(
            order_day.label("day"),
            func.sum(OrderItem.quantity).label("items_sold"),
            func.sum(OrderItem.line_total).label("total_amount"),
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.status.in_(_COUNTED_ORDER_STATUSES))
        .group_by(order_day)
    )
    pos_rows = (await db.execute(pos_stmt)).all()
    order_rows = (await db.execute(order_stmt)).all()

    totals: dict[date, dict[str, float]] = {}
    for row in (*pos_rows, *order_rows):
        bucket = totals.setdefault(row.day, {"items_sold": 0, "total_amount": 0.0})
        bucket["items_sold"] += int(row.items_sold)
        bucket["total_amount"] += float(row.total_amount)

    newest_first = sorted(totals, reverse=True)[:days]
    return [
        DailySalesRead(day=day, items_sold=int(totals[day]["items_sold"]), total_amount=totals[day]["total_amount"])
        for day in newest_first
    ]


@router.get("/dashboard", response_model=DashboardRead)
async def dashboard(
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_read_roles),
    days: int = Query(default=30, ge=1, le=365),
) -> DashboardRead:
    """Everything an owner needs to audit how the shop is doing at a
    glance: revenue split by how it was sold (retail/wholesale/pack),
    what's moving, what's low, and who owes what. Every figure here is
    traceable back to an append-only ledger (pos_sale_items,
    stock_movements, customer_credit_ledger) -- nothing is a bare counter
    trusted on its own.
    """
    since = datetime.now(UTC) - timedelta(days=days)

    pos_tier_stmt = (
        select(
            POSSaleItem.price_tier,
            func.sum(POSSaleItem.quantity).label("items_sold"),
            func.sum(POSSaleItem.line_total).label("revenue"),
        )
        .join(POSSale, POSSale.id == POSSaleItem.sale_id)
        .where(POSSale.status != "voided", POSSale.created_at >= since)
        .group_by(POSSaleItem.price_tier)
    )
    tier_rows = (await db.execute(pos_tier_stmt)).all()
    revenue_by_tier = [
        TierRevenue(price_tier=row.price_tier, items_sold=int(row.items_sold), revenue=float(row.revenue))
        for row in tier_rows
    ]

    order_totals_stmt = select(
        func.coalesce(func.sum(OrderItem.quantity), 0),
        func.coalesce(func.sum(OrderItem.line_total), 0),
    ).select_from(OrderItem).join(Order, Order.id == OrderItem.order_id).where(
        Order.status.in_(_COUNTED_ORDER_STATUSES), Order.created_at >= since
    )
    storefront_items, storefront_revenue = (await db.execute(order_totals_stmt)).one()
    if storefront_items:
        revenue_by_tier.append(
            TierRevenue(
                price_tier=PriceTier.retail,
                items_sold=int(storefront_items),
                revenue=float(storefront_revenue),
            )
        )

    gross_revenue = sum(t.revenue for t in revenue_by_tier)
    items_sold = sum(t.items_sold for t in revenue_by_tier)

    top_variants_stmt = (
        select(
            POSSaleItem.variant_id,
            Product.name.label("product_name"),
            ProductVariant.size,
            ProductVariant.color,
            func.sum(POSSaleItem.quantity).label("units_sold"),
            func.sum(POSSaleItem.line_total).label("revenue"),
        )
        .join(POSSale, POSSale.id == POSSaleItem.sale_id)
        .join(ProductVariant, ProductVariant.id == POSSaleItem.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(POSSale.status != "voided", POSSale.created_at >= since)
        .group_by(POSSaleItem.variant_id, Product.name, ProductVariant.size, ProductVariant.color)
        .order_by(func.sum(POSSaleItem.quantity).desc())
        .limit(10)
    )
    top_variants = [
        TopVariantRead(
            variant_id=row.variant_id,
            product_name=row.product_name,
            size=row.size,
            color=row.color,
            units_sold=int(row.units_sold),
            revenue=float(row.revenue),
        )
        for row in (await db.execute(top_variants_stmt)).all()
    ]

    low_stock_count = await db.scalar(
        select(func.count())
        .select_from(ProductVariant)
        .where(ProductVariant.is_active.is_(True), ProductVariant.stock_quantity <= ProductVariant.low_stock_threshold)
    )

    # Aged debtors: for each customer still carrying a balance, how long
    # ago was the oldest charge that (on a simple first-in-first-out
    # assumption) hasn't been paid off yet. Approximate by design -- the
    # ledger records amounts, not which specific charge a given payment
    # settled -- but good enough to flag "this has been outstanding a
    # while" for follow-up.
    oldest_charge_stmt = (
        select(
            CustomerCreditLedger.customer_id,
            func.min(CustomerCreditLedger.created_at).label("oldest_charge_at"),
        )
        .where(CustomerCreditLedger.entry_type == CreditLedgerEntryType.charge)
        .group_by(CustomerCreditLedger.customer_id)
    )
    oldest_charge_rows = (await db.execute(oldest_charge_stmt)).all()
    oldest_charge_by_customer = {row.customer_id: row.oldest_charge_at for row in oldest_charge_rows}

    debtors_stmt = (
        select(Customer)
        .where(Customer.outstanding_balance > 0)
        .order_by(Customer.outstanding_balance.desc())
    )
    debtors = (await db.scalars(debtors_stmt)).all()
    now = datetime.now(UTC)
    aged_debtors = []
    for customer in debtors:
        oldest_charge_at = oldest_charge_by_customer.get(customer.id)
        days_outstanding = (now - oldest_charge_at).days if oldest_charge_at else None
        aged_debtors.append(
            AgedDebtorRead(
                customer_id=customer.id,
                customer_name=customer.full_name,
                business_name=customer.business_name,
                outstanding_balance=float(customer.outstanding_balance),
                credit_limit=float(customer.credit_limit),
                oldest_unpaid_charge_at=oldest_charge_at,
                days_outstanding=days_outstanding,
            )
        )

    return DashboardRead(
        period_days=days,
        gross_revenue=gross_revenue,
        items_sold=items_sold,
        revenue_by_tier=revenue_by_tier,
        top_variants=top_variants,
        low_stock_count=int(low_stock_count or 0),
        aged_debtors=aged_debtors,
        total_outstanding_credit=sum(d.outstanding_balance for d in aged_debtors),
    )
