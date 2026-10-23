// Shapes from services/api (app/schemas.py) that the admin uses. Written by
// hand: they read better than generated OpenAPI types, and a mismatch shows
// up immediately in the screens that use them.

export type StaffRole = "owner" | "inventory_manager" | "order_fulfillment" | "viewer";

export type Staff = {
  id: string;
  email: string | null;
  full_name: string;
  // What they can do is the union of these. Owner and Viewer stand alone.
  roles: StaffRole[];
  // The most senior of `roles`, for a single label.
  role: StaffRole;
  is_active: boolean;
  created_at: string;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  must_change_password: boolean;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
  display_order: number;
};

export type ProductStatus = "draft" | "active" | "archived";

export type ProductImage = {
  id: string;
  product_id: string;
  storage_path: string;
  alt_text: string | null;
  display_order: number;
  is_primary: boolean;
};

export type Variant = {
  id: string;
  product_id: string;
  sku: string;
  size: string;
  color: string | null;
  color_hex: string | null;
  price_override: number | null;
  wholesale_price: number | null;
  pack_price: number | null;
  pack_size: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
};

export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category_id: string;
  brand: string | null;
  base_price: number;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
  images: ProductImage[];
  variants: Variant[];
};

export type InventoryRow = Variant & {
  product_name: string;
  product_status: ProductStatus;
  category_id: string;
  category_name: string;
  image_storage_path: string | null;
};

export type LowStockRow = Variant & { product_name: string; image_storage_path: string | null };

export type MovementType = "restock" | "sale" | "adjustment" | "return" | "initial";

export type StockMovement = {
  id: string;
  variant_id: string;
  movement_type: MovementType;
  quantity_change: number;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  product_name: string | null;
  variant_sku: string | null;
  variant_size: string | null;
  variant_color: string | null;
  performed_by_name: string | null;
  unit_price: number | null;
};

export type StockIntakeResult = { product: Product; variant: Variant; created_product: boolean; created_variant: boolean };

export type CustomerType = "retail" | "wholesale";
export type CustomerStatus = "pending" | "approved" | "rejected";

export type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  customer_type: CustomerType;
  status: CustomerStatus;
  business_name: string | null;
  tax_id: string | null;
  notes: string | null;
  credit_limit: number;
  outstanding_balance: number;
  is_wholesale_verified: boolean;
  created_at: string;
};

export type LedgerEntry = {
  id: string;
  entry_type: "charge" | "payment" | "adjustment";
  amount: number;
  reason: string | null;
  reference_type: string | null;
  created_at: string;
  performed_by_name: string | null;
};

export type OrderStatus = "pending" | "paid" | "packed" | "shipped" | "delivered" | "cancelled" | "refunded";

export type Address = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string | null;
  country: string;
};

export type OrderItem = {
  id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_id: string;
  product_name: string;
  variant_sku: string;
  variant_size: string;
  variant_color: string | null;
  image_storage_path: string | null;
};

export type Order = {
  id: string;
  order_number: string;
  customer_id: string;
  order_type: CustomerType;
  status: OrderStatus;
  fulfillment_method: "delivery" | "pickup";
  subtotal: number;
  total: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_address: Address | null;
  status_history: { status: OrderStatus; note: string | null; created_at: string }[];
};

export type PriceTier = "retail" | "wholesale" | "pack";
export type PaymentMethod = "cash" | "mobile_money" | "card" | "credit";

export type PosSaleItem = {
  id: string;
  variant_id: string | null;
  product_name: string | null;
  variant_size: string | null;
  variant_color: string | null;
  category_id: string | null;
  category_name: string | null;
  note: string | null;
  price_tier: PriceTier;
  quantity: number;
  unit_price: number;
  line_total: number;
  pack_size: number | null;
};

export type PosSale = {
  id: string;
  customer_id: string | null;
  status: string;
  created_at: string;
  staff_name: string | null;
  customer_name: string | null;
  items: PosSaleItem[];
  payments: { method: PaymentMethod; amount: number }[];
  total: number;
  credit_amount: number;
  // Set on a voided sale.
  voided_at: string | null;
  voided_by: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
};

export type Dashboard = {
  period_days: number;
  gross_revenue: number;
  items_sold: number;
  revenue_by_tier: { price_tier: PriceTier; items_sold: number; revenue: number }[];
  top_variants: { variant_id: string; product_name: string; size: string; color: string | null; units_sold: number; revenue: number }[];
  low_stock_count: number;
  aged_debtors: {
    customer_id: string;
    customer_name: string;
    business_name: string | null;
    outstanding_balance: number;
    credit_limit: number;
    days_outstanding: number | null;
  }[];
  total_outstanding_credit: number;
  unidentified_item_count: number;
};

export type DailySales = { day: string; items_sold: number; total_amount: number };

export type AuditEntry = {
  id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
  staff_name: string | null;
};

// ---------- sales report & activity (GET /reports/sales, /reports/activity) ----------

export type SalesTotals = {
  revenue: number;
  counter_revenue: number;
  online_revenue: number;
  receipts: number;
  online_orders: number;
  items_sold: number;
  average_receipt: number;
  by_method: Record<PaymentMethod, number>;
  voided_count: number;
  voided_amount: number;
  credit_given: number;
  credit_collected: number;
};

export type SalesPeriod = {
  start: string;
  end: string;
  receipts: number;
  online_orders: number;
  items_sold: number;
  counter_revenue: number;
  online_revenue: number;
  revenue: number;
  cash: number;
  mobile_money: number;
  card: number;
  credit: number;
  voided_count: number;
  voided_amount: number;
};

export type ProductSales = {
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  sku: string | null;
  size: string | null;
  color: string | null;
  category_name: string | null;
  quantity: number;
  revenue: number;
  counter_quantity: number;
  online_quantity: number;
};

export type StaffSales = {
  staff_id: string;
  staff_name: string;
  receipts: number;
  items_sold: number;
  revenue: number;
  cash_taken: number;
  voided_count: number;
  voided_amount: number;
  voids_performed: number;
};

export type SalesReport = {
  date_from: string;
  date_to: string;
  group_by: "day" | "week" | "month";
  timezone: string;
  totals: SalesTotals;
  periods: SalesPeriod[];
  by_product: ProductSales[];
  by_staff: StaffSales[];
  by_category: { category_name: string; quantity: number; revenue: number }[];
};

export type ActivityKind = "sale" | "void" | "stock" | "catalog" | "order" | "credit" | "staff";

export type Activity = {
  at: string;
  kind: ActivityKind;
  staff_id: string | null;
  staff_name: string | null;
  summary: string;
  detail: string | null;
  amount: number | null;
  reference_type: string | null;
  reference_id: string | null;
};
