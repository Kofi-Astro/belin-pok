// Response/request shapes from services/api (app/schemas.py) -- only the
// parts the storefront uses. Kept by hand rather than generated: the API
// is small, and these read better than generated OpenAPI types.

export type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
};

export type ProductImage = {
  id: string;
  storage_path: string;
  alt_text: string | null;
  is_primary: boolean;
  display_order: number;
};

export type ProductVariant = {
  id: string;
  product_id: string;
  sku: string;
  size: string;
  color: string | null;
  color_hex: string | null;
  // Null means "same as the product's base_price".
  price_override: number | null;
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
  status: "draft" | "active" | "archived";
  created_at: string;
  images: ProductImage[];
  variants: ProductVariant[];
};

export type ProductSort = "name" | "price_asc" | "price_desc" | "newest";

export type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  customer_type: "retail" | "wholesale";
  status: "pending" | "approved" | "rejected";
};

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

export type AddressInput = Omit<Address, "id" | "is_default"> & { is_default?: boolean };

export type OrderStatus = "pending" | "paid" | "packed" | "shipped" | "delivered" | "cancelled" | "refunded";

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
  image_storage_path: string | null;
};

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

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  must_change_password: boolean;
};
