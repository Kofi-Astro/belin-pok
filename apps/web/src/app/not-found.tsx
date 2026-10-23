// The storefront's 404 page. Next.js shows it for any URL with no route,
// and for any page that calls notFound() -- most often a product or
// category link that has gone stale because the item was unpublished or
// archived (the public API stops returning anything that isn't live).
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">We couldn&apos;t find that page</h1>
      <p className="mt-3 text-muted">It may have sold out and been taken down, or the link is mistyped.</p>
      {/* Two ways back into the shop, so a dead link doesn't end the visit. */}
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/shop" className="btn-dark">
          Browse the shop
        </Link>
        <Link href="/" className="btn-outline">
          Home
        </Link>
      </div>
    </div>
  );
}
