"""Owner/inventory_manager-only reporting: daily sales history, the admin
dashboard's aggregate figures (revenue by price tier, top sellers, low
stock, wholesale debtors), the sales report (tallies for any period,
broken down by day/week/month, product, staff member and category) and
the owner's activity log. Read-only -- everything here is derived from
other tables' data, nothing is written here."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import require_role
from app.models import (
    AuditLog,
    Category,
    CreditLedgerEntryType,
    Customer,
    CustomerCreditLedger,
    Order,
    OrderItem,
    OrderStatus,
    OrderStatusHistory,
    PaymentMethod,
    POSSale,
    POSSaleItem,
    POSSalePayment,
    PriceTier,
    Product,
    ProductVariant,
    Staff,
    StaffRole,
    StockMovement,
    StockMovementType,
)
from app.schemas import (
    ActivityRead,
    AgedDebtorRead,
    CategorySales,
    DailySalesRead,
    DashboardRead,
    ProductSales,
    SalesPeriod,
    SalesReport,
    SalesTotals,
    StaffSales,
    TierRevenue,
    TopVariantRead,
)
from app.shop_time import day_range
from app.shop_time import today as shop_today

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
    of sale (see migrations/20260817120010_pos_sale_items.sql for
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

    order_totals_stmt = (
        select(
            func.coalesce(func.sum(OrderItem.quantity), 0),
            func.coalesce(func.sum(OrderItem.line_total), 0),
        )
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.status.in_(_COUNTED_ORDER_STATUSES), Order.created_at >= since)
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

    # "Quick logged" lines (see POSSaleItemCreate) still waiting for a
    # real product attached -- an all-time backlog, not scoped to `days`,
    # since it's a to-do count rather than a trend.
    unidentified_item_count = await db.scalar(
        select(func.count())
        .select_from(POSSaleItem)
        .join(POSSale, POSSale.id == POSSaleItem.sale_id)
        .where(POSSaleItem.variant_id.is_(None), POSSale.status != "voided")
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
        select(Customer).where(Customer.outstanding_balance > 0).order_by(Customer.outstanding_balance.desc())
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
        unidentified_item_count=int(unidentified_item_count or 0),
    )


# ---------- sales report ----------

Grouping = Literal["day", "week", "month"]
_MAX_REPORT_DAYS = 731


def _period_start(d: date, group_by: Grouping) -> date:
    """The day/week/month a date falls in -- weeks start on Monday, matching
    Postgres's date_trunc('week', ...)."""
    if group_by == "week":
        return d - timedelta(days=d.weekday())
    if group_by == "month":
        return d.replace(day=1)
    return d


def _next_period(d: date, group_by: Grouping) -> date:
    if group_by == "week":
        return d + timedelta(days=7)
    if group_by == "month":
        return (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return d + timedelta(days=1)


@router.get("/sales", response_model=SalesReport)
async def sales_report(
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_read_roles),
    date_from: date | None = None,
    date_to: date | None = None,
    group_by: Grouping = "day",
) -> SalesReport:
    """Everything sold between two dates (inclusive, in the shop's
    timezone; both default to today): totals, a tally row per day/week/
    month -- every period in the range, zero ones included, so a day with
    no sales shows as a zero rather than silently missing -- and
    breakdowns by product, by staff member and by category.

    Same counting rules as the dashboard: counter sales unless voided,
    online orders unless cancelled or refunded, both at the price actually
    charged. Voids are reported separately, by when the void happened.
    """
    date_to = date_to or shop_today()
    date_from = date_from or date_to
    if date_from > date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The start date is after the end date")
    if (date_to - date_from).days > _MAX_REPORT_DAYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a range of at most two years")

    tz = get_settings().shop_timezone
    start, end = day_range(date_from, date_to)

    def bucket(column):
        # The local calendar day/week/month a timestamp falls in.
        return cast(func.date_trunc(group_by, func.timezone(tz, column)), Date)

    completed = (POSSale.status == "completed", POSSale.created_at >= start, POSSale.created_at < end)
    voided_at = func.coalesce(POSSale.voided_at, POSSale.created_at)
    voided_in_range = (POSSale.status == "voided", voided_at >= start, voided_at < end)
    counted_orders = (Order.status.in_(_COUNTED_ORDER_STATUSES), Order.created_at >= start, Order.created_at < end)

    # --- the tally, one row per period ---
    periods: dict[date, dict] = {}
    cursor = _period_start(date_from, group_by)
    while cursor <= date_to:
        periods[cursor] = dict.fromkeys(("receipts", "online_orders", "items_sold", "voided_count"), 0) | dict.fromkeys(
            ("counter_revenue", "online_revenue", "cash", "mobile_money", "card", "credit", "voided_amount"), 0.0
        )
        cursor = _next_period(cursor, group_by)

    counter_rows = await db.execute(
        select(
            bucket(POSSale.created_at).label("b"),
            func.count(func.distinct(POSSale.id)),
            func.sum(POSSaleItem.quantity),
            func.sum(POSSaleItem.line_total),
        )
        .join(POSSaleItem, POSSaleItem.sale_id == POSSale.id)
        .where(*completed)
        .group_by("b")
    )
    for b, receipts, items, revenue in counter_rows:
        p = periods[b]
        p["receipts"], p["items_sold"], p["counter_revenue"] = receipts, int(items), float(revenue)

    method_rows = await db.execute(
        select(bucket(POSSale.created_at).label("b"), POSSalePayment.method, func.sum(POSSalePayment.amount))
        .join(POSSalePayment, POSSalePayment.sale_id == POSSale.id)
        .where(*completed)
        .group_by("b", POSSalePayment.method)
    )
    for b, method, amount in method_rows:
        periods[b][method.value] = float(amount)

    void_rows = await db.execute(
        select(bucket(voided_at).label("b"), func.count(func.distinct(POSSale.id)), func.sum(POSSaleItem.line_total))
        .join(POSSaleItem, POSSaleItem.sale_id == POSSale.id)
        .where(*voided_in_range)
        .group_by("b")
    )
    for b, count, amount in void_rows:
        periods[b]["voided_count"], periods[b]["voided_amount"] = count, float(amount)

    order_rows = await db.execute(
        select(
            bucket(Order.created_at).label("b"),
            func.count(func.distinct(Order.id)),
            func.sum(OrderItem.quantity),
            func.sum(OrderItem.line_total),
        )
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(*counted_orders)
        .group_by("b")
    )
    for b, orders, items, revenue in order_rows:
        p = periods[b]
        p["online_orders"], p["online_revenue"] = orders, float(revenue)
        p["items_sold"] += int(items)

    period_list = []
    for period_start, p in periods.items():
        period_end = min(_next_period(period_start, group_by) - timedelta(days=1), date_to)
        period_list.append(
            SalesPeriod(
                start=max(period_start, date_from),
                end=period_end,
                revenue=p["counter_revenue"] + p["online_revenue"],
                **p,
            )
        )

    # --- by product (and, from the same rows, by category) ---
    products: dict[object, dict] = {}

    def add_product(key, row, quantity, revenue, channel, name=None):
        entry = products.setdefault(
            key,
            {
                "product_id": row.product_id,
                "variant_id": row.variant_id,
                "product_name": name or row.product_name,
                "sku": row.sku,
                "size": row.size,
                "color": row.color,
                "category_name": row.category_name,
                "quantity": 0,
                "revenue": 0.0,
                "counter_quantity": 0,
                "online_quantity": 0,
            },
        )
        entry["quantity"] += int(quantity)
        entry["revenue"] += float(revenue)
        entry[f"{channel}_quantity"] += int(quantity)

    # A quick-logged line has no variant: it's grouped under its category.
    # An unsorted line (a busy-hour basket rung up as one amount) has
    # neither, and is grouped on its own until someone breaks it down.
    line_category = func.coalesce(Product.category_id, POSSaleItem.category_id)
    counter_products = await db.execute(
        select(
            POSSaleItem.variant_id,
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            ProductVariant.sku,
            ProductVariant.size,
            ProductVariant.color,
            Category.id.label("category_id"),
            Category.name.label("category_name"),
            func.sum(POSSaleItem.quantity).label("quantity"),
            func.sum(POSSaleItem.line_total).label("revenue"),
        )
        .join(POSSale, POSSale.id == POSSaleItem.sale_id)
        .outerjoin(ProductVariant, ProductVariant.id == POSSaleItem.variant_id)
        .outerjoin(Product, Product.id == ProductVariant.product_id)
        .outerjoin(Category, Category.id == line_category)
        .where(*completed)
        .group_by(
            POSSaleItem.variant_id,
            Product.id,
            Product.name,
            ProductVariant.sku,
            ProductVariant.size,
            ProductVariant.color,
            Category.id,
            Category.name,
        )
    )
    for row in counter_products:
        if row.variant_id is None and row.category_id is None:
            add_product(("unsorted",), row, row.quantity, row.revenue, "counter", name="Unsorted sales (to break down)")
            products[("unsorted",)]["category_name"] = "Unsorted"
        elif row.variant_id is None:
            name = f"Unidentified {row.category_name} (quick log)"
            add_product(("quick", row.category_id), row, row.quantity, row.revenue, "counter", name=name)
        else:
            add_product(row.variant_id, row, row.quantity, row.revenue, "counter")

    online_products = await db.execute(
        select(
            OrderItem.variant_id,
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            ProductVariant.sku,
            ProductVariant.size,
            ProductVariant.color,
            Category.name.label("category_name"),
            func.sum(OrderItem.quantity).label("quantity"),
            func.sum(OrderItem.line_total).label("revenue"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .join(ProductVariant, ProductVariant.id == OrderItem.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Category, Category.id == Product.category_id)
        .where(*counted_orders)
        .group_by(
            OrderItem.variant_id,
            Product.id,
            Product.name,
            ProductVariant.sku,
            ProductVariant.size,
            ProductVariant.color,
            Category.name,
        )
    )
    for row in online_products:
        add_product(row.variant_id, row, row.quantity, row.revenue, "online")

    by_product = sorted((ProductSales(**p) for p in products.values()), key=lambda p: (-p.revenue, p.product_name))
    categories: dict[str, dict] = {}
    for p in by_product:
        c = categories.setdefault(p.category_name or "Uncategorised", {"quantity": 0, "revenue": 0.0})
        c["quantity"] += p.quantity
        c["revenue"] += p.revenue
    by_category = sorted(
        (CategorySales(category_name=name, **c) for name, c in categories.items()), key=lambda c: -c.revenue
    )

    # --- by staff member (counter sales -- online orders have no cashier) ---
    staff_stats: dict[uuid.UUID, dict] = {}

    def staff_entry(staff_id):
        return staff_stats.setdefault(
            staff_id,
            {
                "receipts": 0,
                "items_sold": 0,
                "revenue": 0.0,
                "cash_taken": 0.0,
                "voided_count": 0,
                "voided_amount": 0.0,
                "voids_performed": 0,
            },
        )

    for staff_id, receipts, items, revenue in await db.execute(
        select(
            POSSale.staff_id,
            func.count(func.distinct(POSSale.id)),
            func.sum(POSSaleItem.quantity),
            func.sum(POSSaleItem.line_total),
        )
        .join(POSSaleItem, POSSaleItem.sale_id == POSSale.id)
        .where(*completed)
        .group_by(POSSale.staff_id)
    ):
        e = staff_entry(staff_id)
        e["receipts"], e["items_sold"], e["revenue"] = receipts, int(items), float(revenue)
    for staff_id, cash in await db.execute(
        select(POSSale.staff_id, func.sum(POSSalePayment.amount))
        .join(POSSalePayment, POSSalePayment.sale_id == POSSale.id)
        .where(*completed, POSSalePayment.method == PaymentMethod.cash)
        .group_by(POSSale.staff_id)
    ):
        staff_entry(staff_id)["cash_taken"] = float(cash)
    for staff_id, count, amount in await db.execute(
        select(POSSale.staff_id, func.count(func.distinct(POSSale.id)), func.sum(POSSaleItem.line_total))
        .join(POSSaleItem, POSSaleItem.sale_id == POSSale.id)
        .where(*voided_in_range)
        .group_by(POSSale.staff_id)
    ):
        e = staff_entry(staff_id)
        e["voided_count"], e["voided_amount"] = count, float(amount)
    for voided_by, count in await db.execute(
        select(POSSale.voided_by, func.count())
        .where(*voided_in_range, POSSale.voided_by.is_not(None))
        .group_by(POSSale.voided_by)
    ):
        staff_entry(voided_by)["voids_performed"] = count

    names = dict((await db.execute(select(Staff.id, Staff.full_name).where(Staff.id.in_(staff_stats)))).all())
    by_staff = sorted(
        (StaffSales(staff_id=sid, staff_name=names.get(sid, "Former staff"), **e) for sid, e in staff_stats.items()),
        key=lambda s: -s.revenue,
    )

    # --- money on account in the period ---
    credit = dict(
        (
            await db.execute(
                select(CustomerCreditLedger.entry_type, func.sum(CustomerCreditLedger.amount))
                .where(CustomerCreditLedger.created_at >= start, CustomerCreditLedger.created_at < end)
                .group_by(CustomerCreditLedger.entry_type)
            )
        ).all()
    )

    online_markup = await db.scalar(
        select(func.coalesce(func.sum((OrderItem.unit_price - OrderItem.in_store_unit_price) * OrderItem.quantity), 0))
        .join(Order, Order.id == OrderItem.order_id)
        .where(*counted_orders, OrderItem.in_store_unit_price.is_not(None))
    )

    counter_revenue = sum(p.counter_revenue for p in period_list)
    online_revenue = sum(p.online_revenue for p in period_list)
    receipts = sum(p.receipts for p in period_list)
    totals = SalesTotals(
        revenue=counter_revenue + online_revenue,
        counter_revenue=counter_revenue,
        online_revenue=online_revenue,
        receipts=receipts,
        online_orders=sum(p.online_orders for p in period_list),
        items_sold=sum(p.items_sold for p in period_list),
        average_receipt=counter_revenue / receipts if receipts else 0.0,
        by_method={m.value: sum(getattr(p, m.value) for p in period_list) for m in PaymentMethod},
        voided_count=sum(p.voided_count for p in period_list),
        voided_amount=sum(p.voided_amount for p in period_list),
        online_markup_earned=float(online_markup),
        credit_given=float(credit.get(CreditLedgerEntryType.charge, 0) or 0),
        # Payments are stored as positive amounts that reduce the balance.
        credit_collected=abs(float(credit.get(CreditLedgerEntryType.payment, 0) or 0)),
    )

    return SalesReport(
        date_from=date_from,
        date_to=date_to,
        group_by=group_by,
        timezone=tz,
        totals=totals,
        periods=period_list,
        by_product=by_product,
        by_staff=by_staff,
        by_category=by_category,
    )


# ---------- activity log ----------

_owner_only = require_role(StaffRole.owner)

# "deleted": records an owner removed outright (see app/erase.py).
ActivityKind = Literal["sale", "void", "stock", "catalog", "order", "credit", "staff", "deleted"]

_STOCK_VERBS = {
    StockMovementType.restock: "Restocked",
    StockMovementType.adjustment: "Corrected stock of",
    StockMovementType.return_: "Took back a return of",
    StockMovementType.initial: "Added opening stock of",
}


def _roles_label(values: dict) -> str:
    roles = values.get("roles") or ([values["role"]] if values.get("role") else [])
    return " + ".join(r.replace("_", " ") for r in roles) or "staff"


def _money(amount: float) -> str:
    return f"GH₵{amount:,.2f}"


# The Website page's sections, as the activity log names them.
_WEBSITE_SECTIONS = {
    "announcement": "announcement",
    "hero": "banner",
    "highlights": "selling points",
    "show_categories": "categories section",
    "show_new_arrivals": "new arrivals section",
    "featured": "featured products",
    "wholesale": "wholesale section",
    "footer_blurb": "footer",
    "contact": "contact details",
    "social": "social links",
}


def _sale_summary(items: int, unsorted: int) -> str:
    """The activity log's headline for a counter sale: "Sold 3 items",
    "Rang up a basket as one amount", or both."""
    parts = []
    if items:
        parts.append(f"Sold {items} item{'s' if items != 1 else ''}")
    if unsorted:
        basket = "a basket" if unsorted == 1 else f"{unsorted} baskets"
        parts.append(f"rang up {basket} as one amount" if items else f"Rang up {basket} as one amount")
    return " and ".join(parts) or "Sold nothing"


@router.get("/activity", response_model=list[ActivityRead])
async def activity_log(
    db: AsyncSession = Depends(get_db),
    _staff: Staff = Depends(_owner_only),
    date_from: date | None = None,
    date_to: date | None = None,
    staff_id: uuid.UUID | None = None,
    kind: ActivityKind | None = None,
    limit: int = Query(default=500, ge=1, le=2000),
) -> list[ActivityRead]:
    """Everything staff did between two dates (defaults: today), newest
    first, in one timeline -- for an owner keeping an eye on the shop from
    elsewhere. Assembled from the records each action already leaves:
    counter sales and voids (pos_sales), stock changes made by hand
    (stock_movements), product/price/staff changes (audit_log), order
    updates (order_status_history) and money taken on account
    (customer_credit_ledger). A sale's own stock movements and credit
    charge aren't repeated -- the sale itself is the entry.
    """
    date_to = date_to or shop_today()
    date_from = date_from or date_to
    start, end = day_range(date_from, date_to)
    events: list[ActivityRead] = []

    def wants(k: str) -> bool:
        return kind is None or kind == k

    staff_names = dict((await db.execute(select(Staff.id, Staff.full_name))).all())

    def who(sid: uuid.UUID | None) -> str | None:
        return staff_names.get(sid) if sid else None

    # Counter sales (and voids), with what was in them.
    if wants("sale") or wants("void"):
        stmt = select(POSSale).where(
            ((POSSale.created_at >= start) & (POSSale.created_at < end))
            | ((POSSale.voided_at >= start) & (POSSale.voided_at < end))
        )
        if staff_id:
            stmt = stmt.where((POSSale.staff_id == staff_id) | (POSSale.voided_by == staff_id))
        sales = (await db.scalars(stmt)).all()
        lines: dict[uuid.UUID, list] = {}
        customers: dict = {}
        if sales:
            line_rows = await db.execute(
                select(
                    POSSaleItem.sale_id,
                    POSSaleItem.quantity,
                    POSSaleItem.line_total,
                    Product.name,
                    ProductVariant.size,
                    Category.name.label("category"),
                    POSSaleItem.note,
                )
                .outerjoin(ProductVariant, ProductVariant.id == POSSaleItem.variant_id)
                .outerjoin(Product, Product.id == ProductVariant.product_id)
                .outerjoin(Category, Category.id == POSSaleItem.category_id)
                .where(POSSaleItem.sale_id.in_([sale.id for sale in sales]))
            )
            for row in line_rows:
                lines.setdefault(row.sale_id, []).append(row)
            customer_ids = {sale.customer_id for sale in sales if sale.customer_id}
            customers = dict(
                (await db.execute(select(Customer.id, Customer.full_name).where(Customer.id.in_(customer_ids)))).all()
            )
        for sale in sales:
            sale_lines = lines.get(sale.id, [])
            total = sum(float(r.line_total) for r in sale_lines)
            # An unsorted line (a basket rung up as one amount) is one line
            # but an unknown number of items, so it isn't counted as "1 item".
            unsorted = sum(1 for r in sale_lines if not r.name and not r.category)
            items = sum(r.quantity for r in sale_lines if r.name or r.category)
            what = ", ".join(
                f"{r.name} ({r.size}) ×{r.quantity}"
                if r.name
                else f"{r.category} (quick log) ×{r.quantity}"
                if r.category
                else f"Unsorted {_money(float(r.line_total))}" + (f" ({r.note})" if r.note else "")
                for r in sale_lines
            )
            if wants("sale") and start <= sale.created_at < end and (not staff_id or sale.staff_id == staff_id):
                to = f" to {customers[sale.customer_id]}" if sale.customer_id in customers else ""
                events.append(
                    ActivityRead(
                        at=sale.created_at,
                        kind="sale",
                        staff_id=sale.staff_id,
                        staff_name=who(sale.staff_id),
                        summary=_sale_summary(items, unsorted) + to,
                        detail=what + (" — later voided" if sale.status == "voided" else ""),
                        amount=total,
                        reference_type="pos_sale",
                        reference_id=sale.id,
                    )
                )
            voided_here = sale.status == "voided" and sale.voided_at and start <= sale.voided_at < end
            if wants("void") and voided_here and (not staff_id or sale.voided_by == staff_id):
                events.append(
                    ActivityRead(
                        at=sale.voided_at,
                        kind="void",
                        staff_id=sale.voided_by,
                        staff_name=who(sale.voided_by),
                        summary=f"Voided a {_money(total)} sale rung up by {who(sale.staff_id) or 'someone'}",
                        detail=f"Reason: {sale.void_reason}" if sale.void_reason else what,
                        amount=-total,
                        reference_type="pos_sale",
                        reference_id=sale.id,
                    )
                )

    # Stock changed by hand (not by a sale).
    if wants("stock"):
        stmt = (
            select(StockMovement, Product.name, ProductVariant.size, ProductVariant.color)
            .join(ProductVariant, ProductVariant.id == StockMovement.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(
                StockMovement.created_at >= start,
                StockMovement.created_at < end,
                StockMovement.movement_type != StockMovementType.sale,
                StockMovement.performed_by.is_not(None),
            )
        )
        if staff_id:
            stmt = stmt.where(StockMovement.performed_by == staff_id)
        for m, name, size, color in await db.execute(stmt):
            label = f"{name} ({size}{' · ' + color if color else ''})"
            change = f"{'+' if m.quantity_change > 0 else ''}{m.quantity_change}"
            events.append(
                ActivityRead(
                    at=m.created_at,
                    kind="stock",
                    staff_id=m.performed_by,
                    staff_name=who(m.performed_by),
                    summary=f"{_STOCK_VERBS.get(m.movement_type, 'Changed stock of')} {label}: {change}",
                    detail=m.reason,
                    reference_type="stock_movement",
                    reference_id=m.id,
                )
            )

    # Product, price and staff changes -- and sales broken down after the
    # fact, which are listed with the sales, and deletions.
    if wants("catalog") or wants("staff") or wants("sale") or wants("deleted"):
        stmt = select(AuditLog).where(AuditLog.created_at >= start, AuditLog.created_at < end)
        if staff_id:
            stmt = stmt.where(AuditLog.staff_id == staff_id)
        entries = (await db.scalars(stmt)).all()
        product_ids = {e.record_id for e in entries if e.table_name == "products" and e.record_id}
        product_names = dict(
            (await db.execute(select(Product.id, Product.name).where(Product.id.in_(product_ids)))).all()
        )
        for e in entries:
            old, new = e.old_values or {}, e.new_values or {}
            if e.action.endswith(".delete"):
                # Anything deleted outright, by an owner. The record is gone,
                # so its description was saved with the entry (see
                # app/erase.record_deletion); older product deletions
                # predate that and only have the product's fields.
                if wants("deleted"):
                    what = old.get("summary") or (f"product {old['name']}" if old.get("name") else "a record")
                    reason = (new or {}).get("reason")
                    detail = " · ".join(filter(None, [old.get("lines"), f"Reason: {reason}" if reason else None]))
                    events.append(
                        ActivityRead(
                            at=e.created_at,
                            kind="deleted",
                            staff_id=e.staff_id,
                            staff_name=who(e.staff_id),
                            summary=f"Deleted {what}",
                            detail=detail or None,
                            amount=None,
                            reference_type=None,
                            reference_id=None,
                        )
                    )
                continue
            if e.action == "pos_sale.break_down":
                if wants("sale"):
                    rung_up_by = who(uuid.UUID(old["rung_up_by"])) if old.get("rung_up_by") else None
                    events.append(
                        ActivityRead(
                            at=e.created_at,
                            kind="sale",
                            staff_id=e.staff_id,
                            staff_name=who(e.staff_id),
                            summary=f"Broke down a {_money(old.get('amount', 0))} sale"
                            + (f" rung up by {rung_up_by}" if rung_up_by else ""),
                            detail=f"{old.get('line')} → " + ", ".join(new.get("parts", [])),
                            reference_type="pos_sale",
                            reference_id=e.record_id,
                        )
                    )
                continue
            is_staff = e.table_name == "staff"
            if not wants("staff" if is_staff else "catalog"):
                continue
            name = new.get("name") or old.get("name") or product_names.get(e.record_id) or "a product"
            person = new.get("full_name") or old.get("full_name") or "a staff member"
            summary = {
                "product.create": f"Created {name}",
                "product.update": f"Changed {name}",
                "inventory.rebalance": f"Repacked {new.get('units_packed')} units into {new.get('pack_count')} pack(s)",
                "staff.invite": f"Invited {person} as {_roles_label(new)}",
                "staff.update": f"Changed {person}'s account",
                "staff.invite_link": f"Issued a new sign-in link for {person}",
                "settings.update": "Changed online pricing",
                "storefront.update": "Changed the website ("
                + ", ".join(_WEBSITE_SECTIONS.get(k, k) for k in new.get("changed", []))
                + ")",
            }.get(e.action, e.action)
            detail = None
            if e.action.endswith("update") or e.action == "settings.update":
                changed = [k for k in new if k in old and old.get(k) != new.get(k)]
                detail = "; ".join(f"{k.replace('_', ' ')}: {old.get(k)} → {new.get(k)}" for k in changed) or None
            events.append(
                ActivityRead(
                    at=e.created_at,
                    kind="staff" if is_staff else "catalog",
                    staff_id=e.staff_id,
                    staff_name=who(e.staff_id),
                    summary=summary,
                    detail=detail,
                    reference_type=e.table_name,
                    reference_id=e.record_id,
                )
            )

    # Online orders moved along.
    if wants("order"):
        stmt = (
            select(OrderStatusHistory, Order.order_number)
            .join(Order, Order.id == OrderStatusHistory.order_id)
            .where(OrderStatusHistory.created_at >= start, OrderStatusHistory.created_at < end)
        )
        if staff_id:
            stmt = stmt.where(OrderStatusHistory.changed_by == staff_id)
        for h, number in await db.execute(stmt):
            events.append(
                ActivityRead(
                    at=h.created_at,
                    kind="order",
                    staff_id=h.changed_by,
                    staff_name=who(h.changed_by),
                    summary=f"Marked order {number} as {h.status.value}",
                    detail=h.note,
                    reference_type="order",
                    reference_id=h.order_id,
                )
            )

    # Money taken on account, and balance corrections. Charges come from
    # sales (already listed) and void reversals come with their void.
    if wants("credit"):
        stmt = (
            select(CustomerCreditLedger, Customer.full_name, Customer.business_name)
            .join(Customer, Customer.id == CustomerCreditLedger.customer_id)
            .where(
                CustomerCreditLedger.created_at >= start,
                CustomerCreditLedger.created_at < end,
                CustomerCreditLedger.entry_type != CreditLedgerEntryType.charge,
                func.coalesce(CustomerCreditLedger.reference_type, "") != "pos_sale_void",
            )
        )
        if staff_id:
            stmt = stmt.where(CustomerCreditLedger.performed_by == staff_id)
        for entry, full_name, business in await db.execute(stmt):
            customer = business or full_name
            amount = abs(float(entry.amount))
            is_payment = entry.entry_type == CreditLedgerEntryType.payment
            summary = (
                f"Received {_money(amount)} from {customer} on account"
                if is_payment
                else f"Corrected {customer}'s balance by {'+' if entry.amount > 0 else '−'}{_money(amount)}"
            )
            events.append(
                ActivityRead(
                    at=entry.created_at,
                    kind="credit",
                    staff_id=entry.performed_by,
                    staff_name=who(entry.performed_by),
                    summary=summary,
                    detail=entry.reason,
                    amount=amount if is_payment else None,
                    reference_type="customer",
                    reference_id=entry.customer_id,
                )
            )

    events.sort(key=lambda e: e.at, reverse=True)
    return events[:limit]
