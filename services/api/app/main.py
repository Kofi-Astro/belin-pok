"""FastAPI app entry point: wires up CORS and registers every router. Run
locally with `uvicorn app.main:app --reload`; in production this is what
Railway points at. See each app/routers/*.py module for what each router
actually does."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (
    audit_log,
    auth,
    categories,
    customers,
    device_tokens,
    health,
    inventory,
    orders,
    pos_sales,
    product_images,
    products,
    public,
    reports,
    shop_settings,
    staff,
    stock_movements,
    storefront,
    uploads,
    variants,
)

settings = get_settings()

app = FastAPI(
    title="Belin-Pok Enterprise API",
    version="0.1.0",
    description="Inventory & admin backend for Belin-Pok Enterprise (Phase 1).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Paginated lists report their total in this header; browsers hide
    # non-standard response headers from cross-origin JavaScript unless
    # they're listed here.
    expose_headers=["X-Total-Count"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(public.router)
app.include_router(categories.router)
app.include_router(products.router)
app.include_router(product_images.router)
app.include_router(variants.router)
app.include_router(stock_movements.router)
app.include_router(staff.router)
app.include_router(customers.router)
app.include_router(orders.router)
app.include_router(device_tokens.router)
app.include_router(reports.router)
app.include_router(audit_log.router)
app.include_router(pos_sales.router)
app.include_router(inventory.router)
app.include_router(uploads.router)
app.include_router(shop_settings.router)
app.include_router(storefront.router)
