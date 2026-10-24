// The site's editable content -- announcement strip, home banner, selling
// points, featured products, wholesale section, footer, contact details and
// social links -- as set on the admin's Website page (GET
// /public/storefront; shape: StorefrontContent in services/api/app/
// schemas.py).
//
// Cached for a minute like the catalogue (lib/catalog.ts), so an edit in
// the admin shows here within that. If the API can't be reached, the
// built-in defaults below (the site's original wording) are used, so the
// header, footer and home page still render rather than erroring.
import { API_BASE_URL } from "./format";
import type { Product } from "./types";

export type HighlightIcon = "store" | "truck" | "boxes" | "bell" | "tag" | "shield" | "star" | "clock" | "card" | "phone" | "heart" | "sparkles";

export type PaymentMethod = "mobile_money" | "cash" | "card" | "bank_transfer";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  mobile_money: "Mobile money",
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
};

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
    // Uploaded banner photos; empty means "use the newest products' photos".
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
  // A promotional banner mid-page (a sale, new stock); off by default.
  promo: { enabled: boolean; eyebrow: string; title: string; text: string; button_label: string; button_link: string; image_path: string | null };
  // The three-step "How to order" strip.
  show_how_to_order: boolean;
  payment_methods: PaymentMethod[];
  // "Visit the shop": shown once there's an address, hours or phone.
  visit: { enabled: boolean; title: string; text: string; hours: string; map_link: string };
  // The featured products themselves: live ones only, at online prices.
  featured_products: Product[];
};

/** The site's original wording -- matches the API's defaults. */
export const DEFAULT_CONTENT: StorefrontContent = {
  announcement: { enabled: true, text: "Retail & wholesale menswear", extra: "Pick up in store or get it delivered" },
  hero: {
    eyebrow: "New season · Now in store",
    title: "Everyday menswear, stocked deep.",
    subtitle: "Caps, tees, jackets and the rest of the wardrobe — for the walk-in shopper and the business buying by the dozen.",
    primary_label: "Shop new arrivals",
    primary_link: "/shop?sort=newest",
    secondary_label: "Buying wholesale?",
    secondary_link: "/wholesale",
    image_paths: [],
  },
  highlights: [
    { icon: "store", title: "Pick up in store", text: "Order online, collect at the shop" },
    { icon: "truck", title: "Or get it delivered", text: "We arrange delivery after you order" },
    { icon: "boxes", title: "Wholesale pricing", text: "Pack and bulk rates for businesses" },
    { icon: "bell", title: "Back-in-stock alerts", text: "Get notified when sizes return" },
  ],
  show_categories: true,
  show_new_arrivals: true,
  featured: { enabled: false, title: "Featured", subtitle: "", product_ids: [] },
  wholesale: {
    enabled: true,
    eyebrow: "For businesses",
    title: "Stocking your own shop?",
    text: "Approved wholesale customers get bulk and factory-pack pricing, and can buy on account. Tell us about your business and we'll set you up.",
    button_label: "How wholesale works",
    button_link: "/wholesale",
    points: [
      { title: "Pack pricing", text: "Factory-sealed packs at a better unit price" },
      { title: "Bulk rates", text: "Wholesale prices on loose units" },
      { title: "Buy on account", text: "Credit for approved businesses" },
      { title: "One supplier", text: "Caps to joggers in one order" },
    ],
  },
  footer_blurb: "Caps, tees, jackets and everyday menswear — for walk-in customers and for businesses buying wholesale.",
  contact: { phone: "", whatsapp: "", email: "", address: "" },
  social: { instagram: "", facebook: "", tiktok: "", x: "" },
  promo: { enabled: false, eyebrow: "This week", title: "", text: "", button_label: "Shop now", button_link: "/shop", image_path: null },
  show_how_to_order: true,
  payment_methods: ["mobile_money", "cash", "card"],
  visit: {
    enabled: true,
    title: "Visit the shop",
    text: "Come in to see the full range, try things on, and talk to us about wholesale.",
    hours: "",
    map_link: "",
  },
  featured_products: [],
};

/** The current content. Called from several server components on one page
 * (header, footer, home); Next.js de-duplicates the identical fetches. */
export async function getStorefront(): Promise<StorefrontContent> {
  try {
    const res = await fetch(`${API_BASE_URL}/public/storefront`, { next: { revalidate: 60 } });
    if (!res.ok) return DEFAULT_CONTENT;
    // Defaults first: any section the API doesn't send (e.g. an older API
    // during a deploy) keeps its default instead of being undefined.
    return { ...DEFAULT_CONTENT, ...((await res.json()) as Partial<StorefrontContent>) };
  } catch {
    // API unreachable (e.g. while building without one): render with defaults.
    return DEFAULT_CONTENT;
  }
}

/** Contact details to show: what's set in the admin, falling back field by
 * field to the build-time settings (NEXT_PUBLIC_CONTACT_*), so a site set
 * up that way keeps its details until they're entered in the admin. Null
 * means "not set" -- the field is left out wherever it would appear. */
export function contactDetails(content: StorefrontContent) {
  const pick = (admin: string, env: string | undefined) => admin.trim() || env || null;
  return {
    phone: pick(content.contact.phone, process.env.NEXT_PUBLIC_CONTACT_PHONE),
    whatsapp: pick(content.contact.whatsapp, process.env.NEXT_PUBLIC_CONTACT_WHATSAPP),
    email: pick(content.contact.email, process.env.NEXT_PUBLIC_CONTACT_EMAIL),
    address: pick(content.contact.address, process.env.NEXT_PUBLIC_SHOP_ADDRESS),
  };
}

/** A link from the admin: a page on this site, or (opened in a new tab) a
 * full web address. */
export const isExternal = (href: string) => /^https?:\/\//.test(href);

/** A WhatsApp chat link for a number typed any way. wa.me needs the
 * country code and digits only, so a Ghana local number ("024 123 4567")
 * becomes 233241234567. */
export function whatsappLink(number: string): string {
  let digits = number.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) digits = `233${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
}
