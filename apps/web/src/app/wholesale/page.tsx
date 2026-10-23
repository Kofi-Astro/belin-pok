import { Boxes, CreditCard, PackageCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT } from "@/lib/format";

export const metadata: Metadata = {
  title: "Wholesale",
  description: "Bulk and factory-pack pricing for businesses, and buying on account for approved wholesale customers.",
};

/** How wholesale works. Wholesale accounts are set up by the shop (staff
 * approve them in the admin app), so this page explains the offer and how
 * to get in touch -- using whichever contact details are configured. */
export default function WholesalePage() {
  return (
    <>
      <section className="bg-brand-900 text-white">
        <div className="container-page py-20">
          <p className="eyebrow text-gold">For businesses</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">
            Wholesale menswear for your shop
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/75">
            Retailers and resellers buy from us by the pack or in bulk. Approved wholesale customers get their own prices and
            can buy on account.
          </p>
        </div>
      </section>

      <section className="container-page grid gap-6 py-20 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [Boxes, "Factory-pack pricing", "Buy sealed packs (e.g. 6 or 12 pieces) at a lower price per piece."],
          [PackageCheck, "Bulk unit rates", "Wholesale prices on loose units, mixed across sizes and styles."],
          [CreditCard, "Buy on account", "Approved businesses can take stock now and settle on account, within an agreed limit."],
          [Users, "Real people", "Your account is set up and looked after by our team — not a form that disappears."],
        ].map(([Icon, title, text]) => {
          const I = Icon as typeof Boxes;
          return (
            <div key={title as string} className="rounded-3xl border border-line bg-white p-7">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <I className="h-6 w-6" />
              </span>
              <h2 className="mt-5 font-extrabold">{title as string}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{text as string}</p>
            </div>
          );
        })}
      </section>

      <section className="container-page">
        <div className="rounded-3xl bg-ink p-10 text-white sm:p-14">
          <h2 className="text-3xl font-extrabold tracking-tight">Open a wholesale account</h2>
          <p className="mt-4 max-w-2xl text-white/70">
            Tell us your business name and what you&apos;re looking to stock. Once your account is approved, your wholesale
            prices apply whenever you buy from us.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {CONTACT.whatsapp && (
              <a href={`https://wa.me/${CONTACT.whatsapp.replace(/\D/g, "")}`} className="btn-primary">
                Message us on WhatsApp
              </a>
            )}
            {CONTACT.phone && (
              <a href={`tel:${CONTACT.phone}`} className="btn border border-white/30 text-white hover:bg-white/10">
                Call {CONTACT.phone}
              </a>
            )}
            {CONTACT.email && (
              <a href={`mailto:${CONTACT.email}?subject=Wholesale%20account`} className="btn border border-white/30 text-white hover:bg-white/10">
                Email us
              </a>
            )}
            {!CONTACT.whatsapp && !CONTACT.phone && !CONTACT.email && (
              <p className="font-semibold text-gold">Visit the shop and ask for a wholesale account.</p>
            )}
          </div>
          {CONTACT.address && <p className="mt-6 text-sm text-white/60">{CONTACT.address}</p>}
        </div>
      </section>

      <section className="container-page pt-16 text-center">
        <Link href="/shop" className="font-bold text-brand-700 hover:underline">
          Browse the catalogue →
        </Link>
      </section>
    </>
  );
}
