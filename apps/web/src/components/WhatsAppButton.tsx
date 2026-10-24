// A round WhatsApp button fixed to the corner of every page, for shoppers who
// would rather ask than browse -- once the shop has a WhatsApp number on the
// Website page. Opens a chat with a greeting already typed.
import { MessageCircle } from "lucide-react";

import { contactDetails, getStorefront, whatsappLink } from "@/lib/content";

export async function WhatsAppButton() {
  const { whatsapp } = contactDetails(await getStorefront());
  if (!whatsapp) return null;
  const text = encodeURIComponent("Hello Belin-Pok, I'd like to ask about ");
  return (
    <a
      href={`${whatsappLink(whatsapp)}?text=${text}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="fixed right-5 bottom-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition hover:scale-105"
    >
      <MessageCircle className="h-7 w-7" />
    </a>
  );
}
