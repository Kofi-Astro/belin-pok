// "Visit the shop": where it is, when it's open, and one-tap directions,
// call and WhatsApp -- most customers still come in person. Shown only once
// the shop has entered an address, hours or a phone number (Website page).
import { Clock, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";

import { contactDetails, type StorefrontContent, whatsappLink } from "@/lib/content";

export function VisitShop({ content }: { content: StorefrontContent }) {
  const { visit } = content;
  const contact = contactDetails(content);
  const hours = visit.hours.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!visit.enabled || (!contact.address && hours.length === 0 && !contact.phone && !contact.whatsapp)) return null;
  return (
    <section className="container-page pt-20">
      <div className="grid gap-8 overflow-hidden rounded-3xl bg-brand-900 p-8 text-white sm:p-12 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="eyebrow text-gold">Come and see us</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{visit.title}</h2>
          {visit.text && <p className="mt-4 max-w-lg leading-relaxed text-white/75">{visit.text}</p>}
          <div className="mt-8 flex flex-wrap gap-3">
            {visit.map_link && (
              <a href={visit.map_link} target="_blank" rel="noopener noreferrer" className="btn-primary">
                <Navigation className="h-4 w-4" /> Get directions
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="btn border border-white/30 text-white hover:bg-white/10">
                <Phone className="h-4 w-4" /> Call us
              </a>
            )}
            {contact.whatsapp && (
              <a href={whatsappLink(contact.whatsapp)} className="btn border border-white/30 text-white hover:bg-white/10">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            )}
          </div>
        </div>
        <dl className="space-y-6 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          {contact.address && (
            <div className="flex gap-4">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <div>
                <dt className="text-xs font-bold tracking-wider text-white/50 uppercase">Address</dt>
                <dd className="mt-1 font-semibold">{contact.address}</dd>
              </div>
            </div>
          )}
          {hours.length > 0 && (
            <div className="flex gap-4">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <div>
                <dt className="text-xs font-bold tracking-wider text-white/50 uppercase">Opening hours</dt>
                {hours.map((line) => (
                  <dd key={line} className="mt-1 font-semibold">
                    {line}
                  </dd>
                ))}
              </div>
            </div>
          )}
          {contact.phone && (
            <div className="flex gap-4">
              <Phone className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <div>
                <dt className="text-xs font-bold tracking-wider text-white/50 uppercase">Phone</dt>
                <dd className="mt-1 font-semibold">{contact.phone}</dd>
              </div>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
