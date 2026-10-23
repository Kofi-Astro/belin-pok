"use client";

import { LogOut, MapPin, Package, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { FormError } from "@/components/AuthCard";
import { useAuth } from "@/lib/auth";
import { formatDate, formatPrice, imageUrl } from "@/lib/format";
import { ApiError, session } from "@/lib/session";
import type { Address, Order, OrderStatus } from "@/lib/types";

const STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  pending: { label: "Awaiting confirmation", tone: "bg-amber-100 text-amber-800" },
  paid: { label: "Paid", tone: "bg-blue-100 text-blue-800" },
  packed: { label: "Packed", tone: "bg-indigo-100 text-indigo-800" },
  shipped: { label: "On its way", tone: "bg-violet-100 text-violet-800" },
  delivered: { label: "Delivered", tone: "bg-green-100 text-green-800" },
  cancelled: { label: "Cancelled", tone: "bg-gray-100 text-gray-700" },
  refunded: { label: "Refunded", tone: "bg-gray-100 text-gray-700" },
};

export default function AccountPage() {
  const router = useRouter();
  const { status, customer, signOut } = useAuth();
  const [tab, setTab] = useState<"orders" | "addresses">("orders");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [addresses, setAddresses] = useState<Address[] | null>(null);

  const load = useCallback(async () => {
    const [o, a] = await Promise.all([
      session.request<Order[]>("/orders/me"),
      session.request<Address[]>("/customers/me/addresses"),
    ]);
    setOrders(o);
    setAddresses(a);
  }, []);

  useEffect(() => {
    if (status === "signedOut") router.replace("/login?next=/account");
    if (status === "signedIn") void load();
  }, [status, router, load]);

  if (status !== "signedIn" || !customer) return <div className="min-h-[60vh]" />;

  return (
    <div className="container-page py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-8">
        <div>
          <p className="eyebrow">My account</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Hello, {customer.full_name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted">{[customer.email, customer.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
          className="btn-outline"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      <div className="mt-8 flex gap-2">
        {(
          [
            ["orders", Package, "Orders"],
            ["addresses", MapPin, "Addresses"],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold ${tab === key ? "bg-brand-900 text-white" : "bg-white text-ink hover:bg-brand-50"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "orders" ? <Orders orders={orders} /> : <Addresses addresses={addresses} onAdded={load} />}
      </div>
    </div>
  );
}

function Orders({ orders }: { orders: Order[] | null }) {
  if (orders === null) return <p className="text-muted">Loading your orders…</p>;
  if (orders.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-line bg-white px-6 py-16 text-center">
        <p className="text-lg font-bold">No orders yet</p>
        <Link href="/shop" className="btn-dark mt-6">
          Start shopping
        </Link>
      </div>
    );
  }
  return (
    <ul className="space-y-4">
      {orders.map((o) => (
        <li key={o.id} className="rounded-3xl border border-line bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-extrabold">{o.order_number}</p>
              <p className="text-sm text-muted">
                {formatDate(o.created_at)} · {o.fulfillment_method === "pickup" ? "Pickup" : "Delivery"}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS[o.status].tone}`}>{STATUS[o.status].label}</span>
              <span className="font-extrabold">{formatPrice(o.total)}</span>
            </div>
          </div>
          <ul className="mt-5 flex flex-wrap gap-4">
            {o.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <Link href={`/products/${item.product_slug}`} className="relative h-16 w-13 shrink-0 overflow-hidden rounded-lg bg-brand-50">
                  {item.image_storage_path && (
                    <Image src={imageUrl(item.image_storage_path)} alt="" fill sizes="52px" className="object-cover" />
                  )}
                </Link>
                <div className="text-sm">
                  <p className="font-semibold">{item.product_name}</p>
                  <p className="text-muted">
                    {[item.variant_color, item.variant_size].filter(Boolean).join(" · ")} × {item.quantity}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Addresses({ addresses, onAdded }: { addresses: Address[] | null; onAdded: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "Home", line1: "", line2: "", city: "", state: "", country: "Ghana" });
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await session.request("/customers/me/addresses", {
        method: "POST",
        body: JSON.stringify({ ...form, line2: form.line2 || null, state: form.state || null, is_default: !addresses?.length }),
      });
      await onAdded();
      setAdding(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that address.");
    }
  };

  if (addresses === null) return <p className="text-muted">Loading…</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {addresses.map((a) => (
        <div key={a.id} className="rounded-3xl border border-line bg-white p-6 text-sm">
          <p className="flex items-center gap-2 font-extrabold">
            {a.label}
            {a.is_default && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">Default</span>}
          </p>
          <p className="mt-2 leading-relaxed text-muted">
            {[a.line1, a.line2, a.city, a.state, a.country].filter(Boolean).join(", ")}
          </p>
        </div>
      ))}

      {adding ? (
        <form onSubmit={save} className="space-y-3 rounded-3xl border border-line bg-white p-6 sm:col-span-2">
          <FormError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="field" placeholder="Label (e.g. Home, Shop)" value={form.label} onChange={set("label")} required />
            <input className="field" placeholder="Street address" value={form.line1} onChange={set("line1")} required />
            <input className="field" placeholder="Landmark / directions" value={form.line2} onChange={set("line2")} />
            <input className="field" placeholder="Town / city" value={form.city} onChange={set("city")} required />
            <input className="field" placeholder="Region" value={form.state} onChange={set("state")} />
            <input className="field" placeholder="Country" value={form.country} onChange={set("country")} required />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-dark">
              Save address
            </button>
            <button type="button" onClick={() => setAdding(false)} className="btn-outline">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line text-sm font-bold text-brand-700 hover:border-brand-600"
        >
          <Plus className="h-5 w-5" /> Add an address
        </button>
      )}
    </div>
  );
}
