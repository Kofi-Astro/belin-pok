// Response/request shapes from services/api (app/schemas.py) -- only the
// parts the storefront uses. Kept by hand rather than generated: the API
// is small, and these read better than generated OpenAPI types.

// A product category (Caps, T-Shirts...). display_order is the order the
// shop arranged them in, which menus follow.
export type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
  // Tile photo set in the admin, or null.
  image_path?: string | null;
};

// A product photo. storage_path is turned into a URL by imageUrl() in
// lib/format.ts (photos are served through the API, /images/<path>).
export type ProductImage = {
  id: string;
  storage_path: string;
  alt_text: string | null;
  is_primary: boolean;
  display_order: number;
};

// One buyable size/colour of a product -- what's actually stocked and
// put in a cart. From the public API, prices here are already the online
// prices, and wholesale/pack prices are never included.
export type ProductVariant = {
  id: string;
  product_id: string;
  sku: string;
  size: string;
  color: string | null;
  // "Type / quality" -- e.g. Standard / Premium, or Unbranded / a brand --
  // each priced on its own. Null when the product has no types.
  style: string | null;
  color_hex: string | null;
  // Null means "same as the product's base_price".
  price_override: number | null;
  // At or below low_stock_threshold, the page says "only N left".
  stock_quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
};

// A product as the public catalogue returns it: only "active" ones are
// ever served to shoppers. base_price is the online price for any size
// without its own price_override.
export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category_id: string;
  brand: string | null;
  base_price: number;
  status: "draft" | "active" | "archived";
  created_at: string;
  images: ProductImage[];
  variants: ProductVariant[];
};

// The sort orders GET /public/products accepts.
export type ProductSort = "name" | "price_asc" | "price_desc" | "newest";

// The signed-in customer's own profile (GET /customers/me).
export type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  customer_type: "retail" | "wholesale";
  status: "pending" | "approved" | "rejected";
};

// A saved delivery address. line2 holds landmarks/directions, which
// matter more than street numbers for deliveries in Ghana.
export type Address = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string | null;
  country: string;
  is_default: boolean;
};

// An address being created (at checkout or on the account page).
export type AddressInput = Omit<Address, "id" | "is_default"> & { is_default?: boolean };

// An order's progress, as the shop updates it from the admin.
export type OrderStatus = "pending" | "paid" | "packed" | "shipped" | "delivered" | "cancelled" | "refunded";

// One line of an order, with the product details copied in at the time
// of ordering -- so an old order still reads correctly after the
// product is renamed or removed. unit_price is what was charged.
export type OrderItem = {
  id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_id: string;
  product_name: string;
  product_slug: string;
  variant_sku: string;
  variant_size: string;
  variant_color: string | null;
  variant_style?: string | null;
  image_storage_path: string | null;
};

// An order as returned by checkout and GET /orders/me. shipping_total is
// 0 for now (delivery is arranged and paid for separately).
export type Order = {
  id: string;
  order_number: string;
  status: OrderStatus;
  fulfillment_method: "delivery" | "pickup";
  subtotal: number;
  shipping_total: number;
  total: number;
  notes: string | null;
  created_at: string;
  customer_name: string;
  items: OrderItem[];
  shipping_address: Address | null;
};

// What POST /orders/checkout takes. guest_* only when not signed in
// (name and phone required for guests); address_id (a saved address) or
// address (a new one) only for delivery.
export type CheckoutRequest = {
  items: { variant_id: string; quantity: number }[];
  guest_full_name?: string;
  guest_email?: string;
  guest_phone?: string;
  fulfillment_method: "delivery" | "pickup";
  address_id?: string;
  address?: AddressInput;
  notes?: string;
};

// What sign-in, sign-up and refresh return; see lib/session.ts.
export type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  must_change_password: boolean;
};
