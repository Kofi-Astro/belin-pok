// The product page's photo gallery. Client-side only because tapping a
// thumbnail changes which photo is shown (React state); the photos are
// still in the server-rendered HTML.
"use client";

import Image from "next/image";
import { useState } from "react";

import { imageUrl } from "@/lib/format";
import type { ProductImage } from "@/lib/types";

/** Big photo plus thumbnails. The primary (cover) photo comes first. */
export function Gallery({ images, name }: { images: ProductImage[]; name: string }) {
  // Cover photo first, then the rest in the order staff arranged them
  // (display_order, set on the product's page in the admin).
  const ordered = [...images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order);
  // Index into ordered of the photo being shown large.
  const [active, setActive] = useState(0);
  const current = ordered[active];

  // A product with no photos yet still gets a correctly-sized placeholder,
  // so the page layout doesn't collapse.
  if (!current) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-3xl bg-brand-50 font-semibold text-brand-700/40">
        No photo yet
      </div>
    );
  }

  return (
    // Thumbnails sit under the big photo on phones (flex-col-reverse) and
    // in a column to its left on wider screens.
    <div className="flex flex-col-reverse gap-4 lg:flex-row">
      {/* No thumbnail strip for a single photo -- nothing to switch to. */}
      {ordered.length > 1 && (
        <div className="flex gap-3 overflow-x-auto lg:w-20 lg:flex-col lg:overflow-visible">
          {ordered.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              className={`relative aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-xl bg-brand-50 ring-2 transition ${
                i === active ? "ring-brand-700" : "ring-transparent hover:ring-line"
              }`}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === active}
            >
              <Image src={imageUrl(img.storage_path)} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="relative aspect-[4/5] flex-1 overflow-hidden rounded-3xl bg-brand-50">
        {/* key forces a fresh <Image> per photo, so the old one isn't shown
           stretched while the new one loads. priority: this is the page's
           main image, so it's fetched straight away rather than lazily. */}
        <Image
          key={current.id}
          src={imageUrl(current.storage_path)}
          alt={current.alt_text ?? name}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
        />
      </div>
    </div>
  );
}
