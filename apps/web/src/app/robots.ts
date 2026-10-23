import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/format";

// Keep crawlers on the catalogue, out of account and checkout pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/account", "/checkout", "/cart", "/order-confirmed", "/reset-password"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
