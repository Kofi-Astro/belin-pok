// Full-screen photo viewer: opened by tapping a product photo. Shows the
// photo at full size (a plain <img> of the original, not a resized copy, so
// pinch-zooming on a phone shows real detail), with swipe / arrow buttons /
// arrow keys to move between photos and Esc, the X or a tap on the
// background to close. Page scrolling is paused while it's open. Rendered
// straight into <body> (a portal), so nothing in the page layout can clip or
// offset it.
"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { imageUrl } from "@/lib/format";

export function Lightbox({
  paths,
  index,
  alt,
  onIndex,
  onClose,
}: {
  paths: string[];
  index: number;
  alt: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const count = paths.length;
  // Wraps around, so "next" on the last photo goes back to the first.
  const go = (by: number) => onIndex((index + by + count) % count);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — photo ${index + 1} of ${count}`}
      onClick={onClose}
      // A horizontal swipe of 50px or more moves to the next/previous photo.
      onTouchStart={(e) => (touchX.current = e.touches.length === 1 ? e.touches[0].clientX : null)}
      onTouchEnd={(e) => {
        if (touchX.current === null || count < 2) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      {/* A spinner while the full-size original downloads (it can take a few
          seconds on mobile data); the photo, drawn on top, covers it once
          it arrives. */}
      <span className="absolute h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element -- the full-size original, for zooming */}
      <img
        key={paths[index]}
        src={imageUrl(paths[index])}
        alt={alt}
        className="relative max-h-[92vh] max-w-[96vw] object-contain select-none"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
        aria-label="Close"
      >
        <X className="h-6 w-6" />
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => (e.stopPropagation(), go(-1))}
            className="absolute left-3 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => (e.stopPropagation(), go(1))}
            className="absolute right-3 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
            aria-label="Next photo"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <p className="absolute bottom-5 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white">
            {index + 1} / {count}
          </p>
        </>
      )}
    </div>,
    document.body,
  );
}
