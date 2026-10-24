// Shapes from services/api (app/schemas.py) that the admin uses. Written by
// hand: they read better than generated OpenAPI types, and a mismatch shows
// up immediately in the screens that use them.

// What a staff member may do -- see ROLES in pages/Settings.tsx for the
// plain-words version and lib/auth.tsx for what each unlocks in the UI.
export type StaffRole = "owner" | "inventory_manager" | "order_fulfillment" | "viewer";

export type Staff = {
  id: string;
  email: string | null;
  // Stored as 0XXXXXXXXX; their sign-in if they have no email.
  phone: string | null;
  full_name: string;
  // What they can do is the union of these. Owner and Viewer stand alone.
  roles: StaffRole[];
  // The most senior of `roles`, for a single label.
  role: StaffRole;
  is_active: boolean;
  created_at: string;
};

// What sign-in and refresh return. must_change_password: the account was
// created with a temporary password (e.g. the first admin), so the admin
// sends them to choose their own before anything else.
export type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  must_change_password: boolean;
};

// parent_id is unused for now (categories are a flat list).
export type Category = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
  display_order: number;
  // Storefront tile photo (storage path), or null.
  image_path: string | null;
};

// draft: being set up, not sold anywhere. active: on the website, app and
// till. archived: off the website; leftover stock can still be sold at
// the till.
export type ProductStatus = "draft" | "active" | "archived";

// storage_path -> URL with imageUrl() in lib/format.ts.
export type ProductImage = {
  id: string;
  product_id: string;
  storage_path: string;
  alt_text: string | null;
  display_order: number;
  is_primary: boolean;
};

// One size/colour of a product -- the unit that's stocked and sold.
// Prices, all in-store unless said otherwise (null = not set):
//   price_override   this size's own retail price (else the product's)
//   wholesale_price  per unit for approved wholesale customers
//   pack_price       for a whole factory pack of pack_size pieces
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
  // Fixed online price; null = in-store price + the shop's online markup.
  online_price: number | null;
  // "Type / quality" (Standard, Premium, Nike...), or null for no type.
  style: string | null;
  // stock_quantity is only ever changed by stock movements. is_active:
  // false hides this size from the website and till.
  stock_quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
};

// base_price: the in-store price of any size without price_override.
// A ₵0 draft is a fast-received item still waiting for its real price.
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

// A variant with its product's details, for the inventory lists.
export type InventoryRow = Variant & {
  product_name: string;
  product_status: ProductStatus;
  category_id: string;
  category_name: string;
  image_storage_path: string | null;
};

export type LowStockRow = Variant & { product_name: string; image_storage_path: string | null };

// Why stock changed: restock (a delivery), sale (till or online; a
// voided sale's reversal is also a "sale" movement, with a positive
// change), adjustment (count corrections, damage, loss), return (a
// customer bringing something back), initial (opening stock).
export type MovementType = "restock" | "sale" | "adjustment" | "return" | "initial";

// One change to stock. quantity_change is signed (+ in, - out).
// reference_type/_id link it to what caused it (a till sale, an online
// order...). unit_price is the price for sales.
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
  variant_style?: string | null;
  performed_by_name: string | null;
  unit_price: number | null;
};

// What Receive stock returns: the product and variant the delivery went
// to, and whether either had to be created for it.
export type StockIntakeResult = { product: Product; variant: Variant; created_product: boolean; created_variant: boolean };

export type CustomerType = "retail" | "wholesale";
export type CustomerStatus = "pending" | "approved" | "rejected";

// is_wholesale_verified: an approved wholesale account -- the only kind
// allowed to buy on credit. outstanding_balance: what they owe now.
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

// One line of a wholesale customer's credit account: a charge (a credit
// sale), a payment, or a correction. amount is signed for corrections.
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

// One line of an online order. unit_price is the online price actually
// charged; product details are copied in at ordering time.
export type OrderItem = {
  id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  // What the same item cost in store when ordered (null for older orders).
  in_store_unit_price: number | null;
  product_id: string;
  product_name: string;
  variant_sku: string;
  variant_size: string;
  variant_color: string | null;
  variant_style?: string | null;
  image_storage_path: string | null;
};

// An online order (website or phone app). status_history: every change
// of status after it was placed, oldest first, with the note given.
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

// Price tier of a till line, and how a till sale was paid ("credit" =
// on a wholesale customer's account).
export type PriceTier = "retail" | "wholesale" | "pack";
export type PaymentMethod = "cash" | "mobile_money" | "card" | "credit";

// One line of a till sale, at the price actually charged. Three kinds:
//   - a product: variant_id set (stock came off when it was sold);
//   - quick-logged: only category_id -- a type of item, its exact
//     product to be attached later ("Identify");
//   - unsorted: neither -- a whole basket rung up as one amount
//     (quantity 1), to be broken down later ("Break down").
// For a pack line, quantity counts pieces and pack_size says how many
// make a pack.
export type PosSaleItem = {
  id: string;
  variant_id: string | null;
  product_name: string | null;
  variant_size: string | null;
  variant_color: string | null;
  variant_style?: string | null;
  category_id: string | null;
  category_name: string | null;
  note: string | null;
  price_tier: PriceTier;
  quantity: number;
  unit_price: number;
  line_total: number;
  pack_size: number | null;
};

// One till receipt: who rang it up, for whom, what was in it and how it
// was paid. status is "completed" or "voided".
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

// GET /reports/dashboard, for the last period_days days.
// unidentified_item_count: till lines still to sort out (all time).
export type Dashboard = {
  period_days: number;
  gross_revenue: number;
  items_sold: number;
  revenue_by_tier: { price_tier: PriceTier; items_sold: number; revenue: number }[];
  top_variants: { variant_id: string; product_name: string; size: string; color: string | null; style?: string | null; units_sold: number; revenue: number }[];
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

// Sales per day, for the dashboard chart. Days with no sales are absent.
export type DailySales = { day: string; items_sold: number; total_amount: number };

// A change recorded in the audit log, with the values before and after.
export type AuditEntry = {
  id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
  staff_name: string | null;
};

// ---------- sales report & activity (GET /reports/sales, /reports/activity) ----------

// Totals for the whole report period. counter = in store (the till);
// online = website/app orders. by_method splits in-store takings by how
// they were paid. online_markup_earned: how much more online orders
// brought in than the same items at in-store prices.
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
  online_markup_earned: number;
  credit_given: number;
  credit_collected: number;
};

// One row of the tally: a day, week or month (start..end, inclusive).
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

// What sold. product_id/variant_id are null for till lines that don't
// name a product yet (grouped by type, or as "Unsorted sales").
export type ProductSales = {
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  sku: string | null;
  size: string | null;
  color: string | null;
  style?: string | null;
  category_name: string | null;
  quantity: number;
  revenue: number;
  counter_quantity: number;
  online_quantity: number;
};

// In-store sales per staff member. voided_*: their sales that were later
// voided (by anyone); voids_performed: voids they carried out.
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

// The activity log's categories (the filter tiles on the Activity page).
export type ActivityKind = "sale" | "void" | "stock" | "catalog" | "order" | "credit" | "staff" | "deleted";

// One entry in the owner's activity log. reference_type/_id say what it
// was about, for the "View" link (see link() in pages/Activity.tsx).
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

// Online pricing: online price = in-store price x (1 + percent/100),
// rounded up to a multiple of online_price_rounding (0 = no rounding).
export type ShopSettings = {
  online_markup_percent: number;
  online_price_rounding: number;
  updated_at: string;
};

// ---------- the website's editable content (GET/PUT /storefront) ----------

/** Icons a selling point can use; the website draws each one. */
export type HighlightIcon = "store" | "truck" | "boxes" | "bell" | "tag" | "shield" | "star" | "clock" | "card" | "phone" | "heart" | "sparkles";

/** Everything the Website page edits. Mirrors StorefrontContent in
 * services/api/app/schemas.py, which supplies the defaults. */
export type StorefrontContent = {
  announcement: { enabled: boolean; text: string; extra: string };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primary_label: string;
    primary_link: string;
    secondary_label: string;
    secondary_link: string;
    // Uploaded photo storage paths; empty = the newest products' photos.
    image_paths: string[];
  };
  highlights: { icon: HighlightIcon; title: string; text: string }[];
  show_categories: boolean;
  show_new_arrivals: boolean;
  featured: { enabled: boolean; title: string; subtitle: string; product_ids: string[] };
  wholesale: {
    enabled: boolean;
    eyebrow: string;
    title: string;
    text: string;
    button_label: string;
    button_link: string;
    points: { title: string; text: string }[];
  };
  footer_blurb: string;
  contact: { phone: string; whatsapp: string; email: string; address: string };
  social: { instagram: string; facebook: string; tiktok: string; x: string };
  // Mid-page promotion banner (off until switched on).
  promo: { enabled: boolean; eyebrow: string; title: string; text: string; button_label: string; button_link: string; image_path: string | null };
  // The "How to order" strip, and the payment methods it and the footer list.
  show_how_to_order: boolean;
  payment_methods: ("mobile_money" | "cash" | "card" | "bank_transfer")[];
  // "Visit the shop": opening hours (one line per day/range) and a map link.
  visit: { enabled: boolean; title: string; text: string; hours: string; map_link: string };
};

export type StorefrontContentRead = { content: StorefrontContent; updated_at: string; updated_by_name: string | null };

