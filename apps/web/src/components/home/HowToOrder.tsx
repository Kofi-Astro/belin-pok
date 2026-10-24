// "How to order": three plain steps, for shoppers who've never ordered from
// the shop online -- and a reminder that WhatsApp and the shop itself work
// too. Ends with the payment methods the shop takes (Website page).
import { MessageCircle, MousePointerClick, PackageCheck, ShoppingBag } from "lucide-react";

import { PAYMENT_LABELS, type StorefrontContent, whatsappLink } from "@/lib/content";

export function HowToOrder({ content, whatsapp }: { content: StorefrontContent; whatsapp: string | null }) {
  const steps = [
    {
      icon: MousePointerClick,
      title: "Choose your items",
      text: "Pick the type, colour and size you want — prices are shown for each.",
    },
    {
      icon: ShoppingBag,
      title: whatsapp ? "Order online or on WhatsApp" : "Order online",
      text: whatsapp
        ? "Check out in a minute, no account needed — or just send us a message with what you want."
        : "Check out in a minute — no account needed. Just a name and phone number.",
    },
    {
      icon: PackageCheck,
      title: "Pick up or get it delivered",
      text: "We call to confirm, then you collect from the shop or we arrange delivery to you.",
    },
  ];
  return (
    <section className="container-page pt-20">
      <div className="rounded-3xl border border-line bg-white p-8 sm:p-12">
        <div className="max-w-2xl">
          <p className="eyebrow">Easy as 1, 2, 3</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight">How to order</h2>
        </div>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="relative">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-900 text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-5xl font-extrabold text-brand-100">{i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-extrabold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-6 text-sm">
          {content.payment_methods.length > 0 && (
            <>
              <span className="font-semibold text-muted">We accept</span>
              {content.payment_methods.map((m) => (
                <span key={m} className="rounded-full bg-brand-50 px-3 py-1 font-bold text-brand-800">
                  {PAYMENT_LABELS[m]}
                </span>
              ))}
            </>
          )}
          {whatsapp && (
            <a href={whatsappLink(whatsapp)} className="ml-auto inline-flex items-center gap-2 font-bold text-[#128C7E] hover:underline">
              <MessageCircle className="h-4 w-4" /> Order on WhatsApp
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
