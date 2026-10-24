// A promotional banner in the middle of the home page -- a sale, new stock,
// a wholesale offer -- set up and switched on from the Website page. A photo
// sits beside the words if one was uploaded; otherwise a drawing of the
// kind of item the promotion is about.
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { isExternal, type StorefrontContent } from "@/lib/content";
import { imageUrl } from "@/lib/format";

import { GarmentArt } from "../GarmentArt";

export function PromoBanner({ promo }: { promo: StorefrontContent["promo"] }) {
  if (!promo.enabled || !promo.title.trim()) return null;
  const button = promo.button_label.trim() && promo.button_link && (
    <span className="btn-primary mt-8 inline-flex">
      {promo.button_label} <ArrowRight className="h-4 w-4" />
    </span>
  );
  const body = (
    <div className="grid overflow-hidden rounded-3xl bg-accent text-white md:grid-cols-2">
      <div className="flex flex-col justify-center p-10 lg:p-14">
        {promo.eyebrow && <p className="eyebrow text-white/80">{promo.eyebrow}</p>}
        <h2 className="mt-3 text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl">{promo.title}</h2>
        {promo.text && <p className="mt-4 max-w-md text-lg leading-relaxed text-white/85">{promo.text}</p>}
        {button}
      </div>
      <div className="relative min-h-64 bg-white/10">
        {promo.image_path ? (
          <Image src={imageUrl(promo.image_path)} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
        ) : (
          <GarmentArt name={promo.title} hint={promo.button_link} dark />
        )}
      </div>
    </div>
  );
  // The whole banner is the link, so it's an easy tap on a phone.
  const href = promo.button_link || "/shop";
  return (
    <section className="container-page pt-20">
      {isExternal(href) ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="block transition hover:opacity-95">
          {body}
        </a>
      ) : (
        <Link href={href} className="block transition hover:opacity-95">
          {body}
        </Link>
      )}
    </section>
  );
}
