import Link from "next/link";

/** The "B" mark from the app icon (apps/storefront/assets/icon/icon.png),
 * redrawn as SVG so it stays crisp at any size, beside the wordmark. */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      {/* Purple rounded square, gold dot, white "B" and an orange underline. */}
      <rect width="64" height="64" rx="14" fill="#4B2884" />
      <circle cx="56" cy="8" r="4" fill="#D4A017" />
      <path
        d="M21 17h13.5c7 0 11 3.2 11 8.4 0 3.4-1.9 5.8-4.9 6.8 3.9.9 6.4 3.6 6.4 7.6 0 5.8-4.4 9.2-12 9.2H21V17Zm12.6 12.7c3.1 0 4.7-1.2 4.7-3.5s-1.6-3.4-4.7-3.4h-5v6.9h5Zm.8 13.3c3.4 0 5.2-1.3 5.2-3.8s-1.8-3.8-5.2-3.8h-5.8V43h5.8Z"
        fill="#fff"
      />
      <rect x="21" y="52" width="22" height="4" rx="2" fill="#D14E0F" />
    </svg>
  );
}

// Mark + wordmark, linking home. light: white text, for dark backgrounds
// like the footer.
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Belin-Pok home">
      <LogoMark />
      <span className={`text-lg leading-none font-extrabold tracking-tight ${light ? "text-white" : "text-brand-900"}`}>
        Belin-Pok
        <span className={`block text-[10px] font-semibold tracking-[0.2em] uppercase ${light ? "text-white/60" : "text-muted"}`}>
          Menswear
        </span>
      </span>
    </Link>
  );
}
