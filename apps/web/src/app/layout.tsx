import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

import { CartDrawer } from "@/components/CartDrawer";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { AuthProvider } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import { SITE_URL } from "@/lib/format";

// The brand typeface (same as the Flutter apps), self-hosted by Next at
// build time -- no request to Google from shoppers' browsers.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Belin-Pok | Menswear, retail & wholesale",
    template: "%s | Belin-Pok",
  },
  description:
    "Caps, t-shirts, jackets, sweatshirts, shorts, joggers and more. Shop online and pick up in store or get it delivered — retail and wholesale.",
  openGraph: { siteName: "Belin-Pok", type: "website", locale: "en_GH" },
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = { themeColor: "#2a1550" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="flex min-h-screen flex-col font-sans">
        <AuthProvider>
          <CartProvider>
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <CartDrawer />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
