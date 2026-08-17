from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (
    audit_log,
    categories,
    customers,
    device_tokens,
    health,
    orders,
    pos_sales,
    product_images,
    products,
    public,
    reports,
    staff,
    stock_movements,
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
)

app.include_router(health.router)
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
