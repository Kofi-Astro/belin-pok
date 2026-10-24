// The till. Build a cart (tap a product, pick size and price tier;
// quick-log by category when there's no time to find the exact SKU; or,
// when the shop is packed, ring up a whole basket as one amount), then
// check out once with one or more payments. POST /pos-sales records the
// sale, deducts stock and charges any credit as one transaction; the
// server re-prices every line and refuses a payment total that doesn't
// match, so the prices here are a preview of exactly what it computes.
// Quick-logged and one-amount lines are sorted out later, from the
// "To sort out" list under Today's sales.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Building2, ChevronDown, Minus, PackageSearch, Plus, Receipt, ScanBarcode, Search, ShoppingBasket, Split, Trash2, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { Thumb } from "@/components/bits";
import { OwnerDeleteButton } from "@/components/DeleteRecord";
import { Modal, useToast } from "@/components/overlay";
import { useInvalidateStock } from "@/components/StockModals";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, IconButton, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { money, primaryImage, saleItemName, sortVariants, timeAgo, titleCase, totalStock, variantLabel, optionLabel } from "@/lib/format";
import { useCategories, useDebounced } from "@/lib/queries";
import type { Category, Customer, PaymentMethod, PosSale, PosSaleItem, PriceTier, Product, Variant } from "@/lib/types";

// Retail: walk-in prices, no customer needed. Wholesale: a wholesale
// customer is chosen first, and wholesale/pack prices (and paying on
// account) become available.
type Mode = "retail" | "wholesale";

// A line in the sale being built: a product, a quick-logged type of item,
// or a one-amount basket. key identifies the line in the list.
type CartLine =
  | { key: string; kind: "item"; product: Product; variant: Variant; tier: PriceTier; quantity: number }
  | { key: string; kind: "quick"; category: Category; unitPrice: number; tier: PriceTier; quantity: number; note: string }
  // A whole basket as one amount -- always quantity 1; broken down later.
  | { key: string; kind: "unsorted"; unitPrice: number; tier: PriceTier; quantity: 1; note: string };

// --- pricing: mirrors _resolve_lines in services/api/app/routers/pos_sales.py ---

const retailPrice = (p: Product, v: Variant) => v.price_override ?? p.base_price;

/** Price per selected unit. For "pack" the unit is a whole pack -- quantity
 * then counts packs, and the server deducts quantity x pack_size pieces. */
function unitPrice(p: Product, v: Variant, tier: PriceTier): number {
  if (tier === "wholesale") return v.wholesale_price ?? retailPrice(p, v);
  if (tier === "pack") return v.pack_price ?? 0;
  return retailPrice(p, v);
}

// The most of a variant that can go on a line: its stock, or for packs,
// how many whole packs that stock makes.
function maxQuantity(v: Variant, tier: PriceTier): number {
  return tier === "pack" ? Math.floor(v.stock_quantity / (v.pack_size ?? 1)) : v.stock_quantity;
}

const lineUnit = (l: CartLine) => (l.kind === "item" ? unitPrice(l.product, l.variant, l.tier) : l.unitPrice);
const lineTotal = (l: CartLine) => Math.round(lineUnit(l) * l.quantity * 100) / 100;

// Payment methods the till offers. "On account" only appears for an
// approved wholesale customer (see CheckoutModal).
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "card", label: "Card" },
  { value: "credit", label: "On account (credit)" },
];

// The till page: product grid on the left, the sale on the right (below
// on tablets), and today's receipts underneath.
export function PosPage() {
  const categories = useCategories();
  const [mode, setMode] = useState<Mode>("retail");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [categoryId, setCategoryId] = useState("");
  const [picking, setPicking] = useState<Product | null>(null);
  const [quickLogging, setQuickLogging] = useState(false);
  const [lumping, setLumping] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  // Live products only, filtered by the search box and category chips.
  const products = useQuery({
    queryKey: ["products", "pos", debounced, categoryId],
    // Only published products can be sold (the API refuses drafts).
    queryFn: () => api.list<Product>("/products", { status: "active", search: debounced, category_id: categoryId, limit: 60 }),
  });

  const total = cart.reduce((n, l) => n + lineTotal(l), 0);
  const count = cart.reduce((n, l) => n + l.quantity, 0);

  // Switching to wholesale asks for the customer straight away; back to
  // retail drops the customer.
  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === "retail") setCustomer(null);
    else if (!customer) setPickingCustomer(true);
  };

  // Adding the same product, size and price tier again tops up that line
  // (up to the stock available) instead of adding a second one.
  const addLine = (line: CartLine) =>
    setCart((current) => {
      if (line.kind === "item") {
        const existing = current.find((l) => l.kind === "item" && l.variant.id === line.variant.id && l.tier === line.tier);
        if (existing && existing.kind === "item") {
          const max = maxQuantity(existing.variant, existing.tier);
          return current.map((l) => (l === existing ? { ...l, quantity: Math.min(max, l.quantity + line.quantity) } : l));
        }
      }
      return [...current, line];
    });

  // Quantity 0 removes the line. A one-amount line has no quantity to
  // change -- it can only be removed.
  const setQty = (key: string, q: number) =>
    setCart((c) =>
      c
        .filter((l) => l.key !== key || q > 0)
        .map((l) =>
          l.key !== key || l.kind === "unsorted" ? l : { ...l, quantity: l.kind === "item" ? Math.min(q, maxQuantity(l.variant, l.tier)) : q },
        ),
    );

  return (
    <>
      <PageHeader
        title="Point of sale"
        description="Ring up counter sales — retail or wholesale."
        actions={
          <div className="flex rounded-lg border border-line bg-white p-0.5 shadow-xs">
            {(["retail", "wholesale"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold ${mode === m ? (m === "wholesale" ? "bg-accent text-white" : "bg-brand-700 text-white") : "text-muted"}`}
              >
                {titleCase(m)}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        {/* Product browser */}
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-48 flex-[1_1_16rem]">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input autoFocus className="h-11 pl-9" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button variant="secondary" icon={Zap} className="h-11" onClick={() => setQuickLogging(true)}>
              Quick log by type
            </Button>
            <Button variant="secondary" icon={ShoppingBasket} className="h-11" onClick={() => setLumping(true)}>
              One amount
            </Button>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {[{ id: "", name: "All" }, ...(categories.data ?? []).filter((c) => c.slug !== "uncategorized")].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${categoryId === c.id ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white hover:border-ink/30"}`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {products.isPending ? (
            <Spinner />
          ) : !products.data?.rows.length ? (
            <Card>
              <EmptyState icon={PackageSearch} title="No live products match" message="Only published products can be sold. Drafts need a price and Publish first." />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {products.data.rows.map((p) => {
                const stock = totalStock(p);
                // Show the lowest retail price across its sizes.
                const prices = p.variants.map((v) => retailPrice(p, v));
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={stock === 0}
                    onClick={() => setPicking(p)}
                    className="group overflow-hidden rounded-xl border border-line bg-white text-left shadow-xs transition hover:border-brand-500 hover:shadow-md disabled:opacity-50"
                  >
                    <div className="aspect-square bg-canvas">
                      {primaryImage(p) && <Thumb path={primaryImage(p)!.storage_path} className="h-full! w-full! rounded-none ring-0" />}
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm leading-snug font-semibold">{p.name}</p>
                      <div className="mt-1.5 flex items-center justify-between text-xs">
                        <span className="tabular font-bold">{money(Math.min(...prices, p.base_price))}</span>
                        <span className={stock === 0 ? "font-semibold text-red-600" : "text-muted"}>{stock === 0 ? "Sold out" : `${stock} left`}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart */}
        <div id="pos-cart" className="scroll-mt-20 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <ScanBarcode className="h-4 w-4 text-brand-600" /> Current sale
                {count > 0 && <Badge tone="brand">{count}</Badge>}
              </h2>
              {cart.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setCart([])}>
                  Clear
                </Button>
              )}
            </div>

            {/* The wholesale customer this sale is for, and their credit left. */}
            {mode === "wholesale" && (
              <button
                type="button"
                onClick={() => setPickingCustomer(true)}
                className="flex w-full items-center gap-3 border-b border-line bg-accent/5 px-5 py-3 text-left text-sm hover:bg-accent/10"
              >
                <Building2 className="h-4 w-4 text-accent" />
                {customer ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{customer.business_name || customer.full_name}</span>
                    <span className="text-xs text-muted">{money(Math.max(0, customer.credit_limit - customer.outstanding_balance))} credit available</span>
                  </span>
                ) : (
                  <span className="flex-1 font-semibold text-accent">Choose wholesale customer</span>
                )}
                <ChevronDown className="h-4 w-4 text-muted" />
              </button>
            )}

            {cart.length === 0 ? (
              <EmptyState icon={Receipt} title="Nothing in the sale yet" message="Tap a product to add it." />
            ) : (
              <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
                {cart.map((l) => (
                  <li key={l.key} className="flex gap-3 px-5 py-3">
                    {l.kind === "item" ? (
                      <Thumb path={primaryImage(l.product)?.storage_path} size={40} />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                        {l.kind === "quick" ? <Zap className="h-4 w-4" /> : <ShoppingBasket className="h-4 w-4" />}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {l.kind === "item" ? l.product.name : l.kind === "quick" ? `${l.category.name} (quick log)` : "Unsorted sale"}
                      </p>
                      <p className="text-xs text-muted">
                        {l.kind === "unsorted" ? (
                          l.note || "To break down later"
                        ) : (
                          <>
                            {l.kind === "item" ? variantLabel(l.variant) : l.note || "Product to be identified"} ·{" "}
                            {l.tier === "pack" && l.kind === "item" ? `pack of ${l.variant.pack_size}` : l.tier} · {money(lineUnit(l))}
                          </>
                        )}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <div className={`inline-flex items-center rounded-lg border border-line ${l.kind === "unsorted" ? "invisible" : ""}`}>
                          <button type="button" className="p-1.5 text-muted hover:text-ink" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="Fewer">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="tabular w-8 text-center text-sm font-semibold">{l.quantity}</span>
                          <button
                            type="button"
                            className="p-1.5 text-muted hover:text-ink disabled:opacity-30"
                            disabled={l.kind === "item" && l.quantity >= maxQuantity(l.variant, l.tier)}
                            onClick={() => setQty(l.key, l.quantity + 1)}
                            aria-label="More"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <span className="tabular text-sm font-semibold">{money(lineTotal(l))}</span>
                      </div>
                    </div>
                    <IconButton icon={Trash2} label="Remove" onClick={() => setQty(l.key, 0)} className="hover:text-red-600" />
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-3 border-t border-line bg-canvas/50 px-5 py-4">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">Total</span>
                <span className="tabular text-2xl font-bold">{money(total)}</span>
              </div>
              <Button className="h-12 w-full text-base" disabled={!cart.length} onClick={() => setCheckingOut(true)}>
                Charge {money(total)}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <TodaysSales />

      {/* Below desktop width the cart sits under the product grid, so keep
          the running total and Charge within reach at the bottom of the
          screen while browsing. */}
      {cart.length > 0 && (
        <>
          <div className="h-20 xl:hidden" />
          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:left-60 xl:hidden">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">
                {count} item{count === 1 ? "" : "s"}
                {customer ? ` · ${customer.business_name || customer.full_name}` : ""}
              </p>
              <p className="tabular text-lg font-bold">{money(total)}</p>
            </div>
            <Button variant="secondary" onClick={() => document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth" })}>
              Review
            </Button>
            <Button onClick={() => setCheckingOut(true)}>Charge</Button>
          </div>
        </>
      )}

      {picking && <VariantPicker product={picking} mode={mode} onClose={() => setPicking(null)} onAdd={(l) => (addLine(l), setPicking(null))} />}
      <QuickLogModal open={quickLogging} onClose={() => setQuickLogging(false)} mode={mode} onAdd={(l) => (addLine(l), setQuickLogging(false))} />
      <OneAmountModal open={lumping} onClose={() => setLumping(false)} mode={mode} onAdd={(l) => (addLine(l), setLumping(false))} />
      <CustomerPicker
        open={pickingCustomer}
        onClose={() => {
          setPickingCustomer(false);
          if (!customer) setMode("retail");
        }}
        onPick={(c) => {
          setCustomer(c);
          setPickingCustomer(false);
        }}
      />
      <CheckoutModal
        open={checkingOut}
        onClose={() => setCheckingOut(false)}
        cart={cart}
        total={total}
        customer={customer}
        onDone={() => {
          setCart([]);
          setCheckingOut(false);
          setCustomer(null);
          setMode("retail");
        }}
      />
    </>
  );
}

// Unique keys for cart lines (only need to be unique per page visit).
let keySeq = 0;
const nextKey = () => `line-${++keySeq}`;

// Picking a size (and, in wholesale mode, a price tier) and quantity for a
// product tapped in the grid. Sold-out sizes are struck through; a single
// size is pre-selected.
function VariantPicker({ product, mode, onClose, onAdd }: { product: Product; mode: Mode; onClose: () => void; onAdd: (l: CartLine) => void }) {
  const active = sortVariants(product.variants.filter((v) => v.is_active));
  const [variant, setVariant] = useState<Variant | null>(active.length === 1 ? active[0] : null);
  const [tier, setTier] = useState<PriceTier>(mode === "wholesale" ? "wholesale" : "retail");
  const [qty, setQty] = useState(1);
  // Wholesale customers can also be sold at retail price (e.g. a one-off
  // item without a wholesale price).
  const tiers: PriceTier[] = mode === "wholesale" ? ["wholesale", "pack", "retail"] : ["retail"];
  const max = variant ? maxQuantity(variant, tier) : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!variant || max === 0}
            onClick={() => variant && onAdd({ key: nextKey(), kind: "item", product, variant, tier, quantity: Math.min(qty, max) })}
          >
            Add {variant ? money(unitPrice(product, variant, tier) * qty) : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold text-ink/80">Size / colour</p>
          <div className="flex flex-wrap gap-2">
            {active.map((v) => (
              <button
                key={v.id}
                type="button"
                disabled={v.stock_quantity === 0}
                onClick={() => {
                  setVariant(v);
                  setQty(1);
                  if (tier === "pack" && !v.pack_size) setTier("wholesale");
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold disabled:line-through disabled:opacity-40 ${variant?.id === v.id ? "border-brand-700 bg-brand-700 text-white" : "border-line hover:border-ink/30"}`}
              >
                {variantLabel(v)} <span className={`ml-1 text-xs ${variant?.id === v.id ? "text-white/70" : "text-muted"}`}>({v.stock_quantity})</span>
                {/* Each option's own price -- types (Standard / Premium...) usually differ. */}
                <span className={`block text-xs font-normal ${variant?.id === v.id ? "text-white/80" : "text-muted"}`}>{money(unitPrice(product, v, tier))}</span>
              </button>
            ))}
          </div>
        </div>
        {tiers.length > 1 && variant && (
          <div>
            <p className="mb-2 text-xs font-semibold text-ink/80">Price</p>
            <div className="grid grid-cols-3 gap-2">
              {tiers.map((t) => {
                // Pack pricing only exists for sizes set up with a pack size and price.
                const unavailable = t === "pack" && (!variant.pack_size || !variant.pack_price);
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={unavailable}
                    onClick={() => {
                      setTier(t);
                      setQty(1);
                    }}
                    className={`rounded-lg border p-2.5 text-left disabled:opacity-40 ${tier === t ? "border-accent bg-accent/5" : "border-line hover:border-ink/30"}`}
                  >
                    <span className="block text-xs font-semibold text-muted">{t === "pack" ? `Pack of ${variant.pack_size ?? "—"}` : titleCase(t)}</span>
                    <span className="tabular font-bold">{unavailable ? "—" : money(unitPrice(product, variant, t))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {variant && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{tier === "pack" ? "Packs" : "Quantity"}</span>
            <div className="inline-flex items-center rounded-lg border border-line">
              <button type="button" className="p-2.5" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Fewer">
                <Minus className="h-4 w-4" />
              </button>
              <span className="tabular w-10 text-center font-semibold">{qty}</span>
              <button type="button" className="p-2.5 disabled:opacity-30" disabled={qty >= max} onClick={() => setQty(qty + 1)} aria-label="More">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {variant && <p className="text-xs text-muted">{max} available{tier === "pack" ? " as full packs" : ""}.</p>}
      </div>
    </Modal>
  );
}

// Quick log: a sale line by type of item ("Caps") with a price and
// quantity, for when finding the exact product would hold up the queue.
// It's identified later from Today's sales, and stock comes off then.
function QuickLogModal({ open, onClose, mode, onAdd }: { open: boolean; onClose: () => void; mode: Mode; onAdd: (l: CartLine) => void }) {
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const category = categories.data?.find((c) => c.id === categoryId);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) return;
    onAdd({ key: nextKey(), kind: "quick", category, unitPrice: Number(price), quantity: Number(qty), note: note.trim(), tier: mode === "wholesale" ? "wholesale" : "retail" });
    setPrice("");
    setQty("1");
    setNote("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick log by type"
      description="For when you know what kind of item sold and its price, but not the exact SKU. Attach the product later from Today's sales — stock is deducted then."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="quick-log">
            Add to sale
          </Button>
        </>
      }
    >
      <form id="quick-log" onSubmit={add} className="grid gap-4 sm:grid-cols-2">
        <Field label="Type of item" className="sm:col-span-2">
          <Select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose…</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price each (GH₵)">
          <Input type="number" required min={0.01} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Quantity">
          <Input type="number" required min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Note (optional)" className="sm:col-span-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. black snapback" />
        </Field>
      </form>
    </Modal>
  );
}

/** For a packed shop: take the money for a whole basket now, as one line,
 * and say what was in it later ("Break down" under To sort out). */
function OneAmountModal({ open, onClose, mode, onAdd }: { open: boolean; onClose: () => void; mode: Mode; onAdd: (l: CartLine) => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd({ key: nextKey(), kind: "unsorted", unitPrice: Math.round(Number(amount) * 100) / 100, quantity: 1, note: note.trim(), tier: mode === "wholesale" ? "wholesale" : "retail" });
    setAmount("");
    setNote("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Ring up as one amount"
      description="Busy? Take the money for the whole basket now and break it down into the items later, from To sort out below. Stock comes off then."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="one-amount">
            Add to sale
          </Button>
        </>
      }
    >
      <form id="one-amount" onSubmit={add} className="space-y-4">
        <Field label="Amount for everything (GH₵)">
          <Input autoFocus type="number" required min={0.01} step="0.01" className="h-12 text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="What's in it (optional)" hint="A few words help whoever breaks it down.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2 tees, a cap, socks" />
        </Field>
      </form>
    </Modal>
  );
}

// Choosing the wholesale customer a sale is for. Unapproved accounts can
// still be chosen (to buy for cash), but can't pay on account.
function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const customers = useQuery({
    queryKey: ["customers", "pos-picker", debounced],
    queryFn: () => api.list<Customer>("/customers", { customer_type: "wholesale", search: debounced, limit: 20 }),
    enabled: open,
  });
  return (
    <Modal open={open} onClose={onClose} title="Wholesale customer" description="Credit sales need an approved account.">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input autoFocus className="pl-9" placeholder="Search businesses…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {customers.data?.rows.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPick(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-canvas">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.business_name || c.full_name}</span>
                <span className="text-xs text-muted">
                  {c.is_wholesale_verified ? `${money(Math.max(0, c.credit_limit - c.outstanding_balance))} credit available` : "Not approved — cash only"}
                </span>
              </span>
              {!c.is_wholesale_verified && <Badge tone="amber">Pending</Badge>}
            </button>
          </li>
        ))}
        {customers.data?.rows.length === 0 && <li className="p-4 text-sm text-muted">No wholesale customers found. Add them under Customers.</li>}
      </ul>
    </Modal>
  );
}

// A payment as it's being entered (the amount as typed).
type PaymentLine = { method: PaymentMethod; amount: string };

// Taking payment: one or more methods (e.g. part cash, part mobile money)
// that must add up to the total exactly before the sale can complete.
// POST /pos-sales re-prices every line, checks stock, takes it off and
// records any credit charge, all at once -- or nothing at all.
function CheckoutModal({
  open,
  onClose,
  cart,
  total,
  customer,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  cart: CartLine[];
  total: number;
  customer: Customer | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start each checkout with one cash line for the full amount.
  // Start each checkout with one cash line for the full amount (reset
  // whenever the dialog opens or the total changes).
  const key = `${open}-${total}`;
  const [lastKey, setLastKey] = useState("");
  if (open && key !== lastKey) {
    setLastKey(key);
    setPayments([{ method: "cash", amount: total.toFixed(2) }]);
    setError(null);
  }

  const paid = payments.reduce((n, p) => n + (Number(p.amount) || 0), 0);
  // What's still to pay (negative: paid too much), and whether the credit
  // part fits within the customer's available credit.
  const remaining = Math.round((total - paid) * 100) / 100;
  const creditAvailable = customer?.is_wholesale_verified ? Math.max(0, customer.credit_limit - customer.outstanding_balance) : 0;
  const credit = payments.filter((p) => p.method === "credit").reduce((n, p) => n + (Number(p.amount) || 0), 0);
  const overLimit = credit > creditAvailable + 0.001;
  // "On account" only for an approved wholesale customer.
  const methods = METHODS.filter((m) => m.value !== "credit" || customer?.is_wholesale_verified);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const sale = await api.post<PosSale>("/pos-sales", {
        customer_id: customer?.id ?? null,
        items: cart.map((l) =>
          l.kind === "item"
            ? { variant_id: l.variant.id, price_tier: l.tier, quantity: l.quantity }
            : l.kind === "quick"
              ? { category_id: l.category.id, price_tier: l.tier, quantity: l.quantity, unit_price: l.unitPrice, note: l.note || null }
              : { price_tier: l.tier, quantity: 1, unit_price: l.unitPrice, note: l.note || null },
        ),
        // Lines left at zero are dropped rather than sent.
        payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) })),
      });
      // Stock, today's sales and (for credit) the customer's balance changed.
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["pos-sales"] }), qc.invalidateQueries({ queryKey: ["customers"] })]);
      toast.success(`Sale recorded — ${money(sale.total)}`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Charge ${money(total)}`}
      description={customer ? `For ${customer.business_name || customer.full_name}` : "Walk-in customer"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button disabled={Math.abs(remaining) > 0.009 || overLimit} loading={busy} onClick={() => void submit()}>
            Complete sale
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        {payments.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Select className="w-52" value={p.method} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentMethod } : x)))}>
              {methods.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Input type="number" min={0} step="0.01" value={p.amount} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            {payments.length > 1 && <IconButton icon={X} label="Remove payment" onClick={() => setPayments(payments.filter((_, j) => j !== i))} className="mt-1" />}
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          onClick={() => setPayments([...payments, { method: payments[0]?.method === "cash" ? "mobile_money" : "cash", amount: Math.max(0, remaining).toFixed(2) }])}
        >
          Split payment
        </Button>
        <div className={`flex justify-between rounded-lg px-3 py-2 text-sm font-semibold ${Math.abs(remaining) < 0.01 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          <span>{Math.abs(remaining) < 0.01 ? "Fully paid" : remaining > 0 ? "Still to pay" : "Paid too much"}</span>
          <span className="tabular">{money(Math.abs(remaining))}</span>
        </div>
        {customer && !customer.is_wholesale_verified && <p className="text-xs text-amber-800">This account isn&apos;t approved, so it can&apos;t buy on credit.</p>}
        {overLimit && <p className="text-sm font-medium text-red-700">That&apos;s more than the {money(creditAvailable)} of credit available.</p>}
      </div>
    </Modal>
  );
}

/** Today's receipts, plus any older sale with lines still to sort out:
 * expand to see lines and payments; void a mistaken sale; attach the exact
 * product to a quick-logged line, or break a one-amount (or mixed
 * quick-logged) line down into what was really in it. */
function TodaysSales() {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const sales = useQuery({ queryKey: ["pos-sales"], queryFn: () => api.get<PosSale[]>("/pos-sales", { limit: 100 }) });
  // Fetched on its own so nothing waiting to be sorted out drops off the
  // list just because it's older than the latest 100 receipts.
  const toSort = useQuery({ queryKey: ["pos-sales", "to-sort"], queryFn: () => api.get<PosSale[]>("/pos-sales", { needs_details: true, limit: 200 }) });
  const [open, setOpen] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<PosSale | null>(null);
  const [identifying, setIdentifying] = useState<{ sale: PosSale; item: PosSaleItem } | null>(null);
  const [breaking, setBreaking] = useState<{ sale: PosSale; item: PosSaleItem } | null>(null);

  const today = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return (sales.data ?? []).filter((s) => new Date(s.created_at) >= start);
  }, [sales.data]);
  const unidentified = toSort.data ?? [];
  const takings = today.filter((s) => s.status !== "voided").reduce((n, s) => n + s.total, 0);

  const [voidReason, setVoidReason] = useState("");
  // Voiding reverses the sale: stock goes back, any credit charge is
  // reversed, and the sale is kept -- marked voided, with who, when and
  // why -- rather than deleted.
  const voidSale = useMutation({
    // A reason is required: voids are what the owner checks first.
    mutationFn: (s: PosSale) => api.post(`/pos-sales/${s.id}/void`, { reason: voidReason.trim() }),
    onSuccess: async () => {
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["pos-sales"] })]);
      toast.success("Sale voided — stock and credit reversed");
      setVoiding(null);
      setVoidReason("");
    },
    onError: (e) => toast.error(e),
  });

  // Today's receipts, then any older ones still to sort out.
  const list = [...today, ...unidentified.filter((s) => !today.some((t) => t.id === s.id))];

  return (
    <Card className="mt-8">
      <CardHeader
        title="Today's sales"
        description={`${today.filter((s) => s.status !== "voided").length} receipts · ${money(takings)} taken today${unidentified.length ? ` · ${unidentified.length} to sort out` : ""}`}
      />
      {!list.length ? (
        <EmptyState icon={Receipt} title="No sales yet today" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-4 px-5 py-3 text-left text-sm hover:bg-canvas">
                <span className="w-24 text-muted">{timeAgo(s.created_at)}</span>
                <span className="min-w-0 flex-1 truncate">{s.items.map(saleItemName).join(", ")}</span>
                {s.customer_name && <Badge tone="brand">{s.customer_name}</Badge>}
                {s.items.some((i) => !i.variant_id) && s.status !== "voided" && <Badge tone="amber">To sort out</Badge>}
                {s.status === "voided" && <Badge tone="red">Voided</Badge>}
                <span className={`tabular w-24 text-right font-semibold ${s.status === "voided" ? "text-muted line-through" : ""}`}>{money(s.total)}</span>
              </button>
              {open === s.id && (
                <div className="space-y-3 bg-canvas/60 px-5 py-4 text-sm">
                  {s.items.map((i) => (
                    <div key={i.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        {i.product_name ? (
                          <>
                            {i.product_name} <span className="text-muted">· {optionLabel(i)}</span>
                          </>
                        ) : i.category_name ? (
                          <>
                            {i.category_name} <span className="text-muted">· quick log{i.note ? ` — ${i.note}` : ""}</span>
                          </>
                        ) : (
                          <>
                            Unsorted sale <span className="text-muted">· one amount{i.note ? ` — ${i.note}` : ""}</span>
                          </>
                        )}
                      </span>
                      <span className="text-muted">
                        {i.variant_id || i.category_id ? `${i.quantity} × ${money(i.unit_price)} · ${i.price_tier}` : money(i.line_total)}
                      </span>
                      {!i.variant_id && s.status !== "voided" && (
                        <span className="flex gap-2">
                          {i.category_id && (
                            <Button size="sm" variant="secondary" onClick={() => setIdentifying({ sale: s, item: i })}>
                              Identify
                            </Button>
                          )}
                          {/* A quick-logged line can be split if it was really several different products. */}
                          {(!i.category_id || i.quantity > 1) && (
                            <Button size="sm" variant={i.category_id ? "ghost" : "secondary"} icon={Split} onClick={() => setBreaking({ sale: s, item: i })}>
                              {i.category_id ? "Split" : "Break down"}
                            </Button>
                          )}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-line pt-3">
                    <span className="text-muted">
                      {s.payments.map((p) => `${METHODS.find((m) => m.value === p.method)?.label}: ${money(p.amount)}`).join(" · ")}
                      {s.staff_name && ` · by ${s.staff_name}`}
                    </span>
                    <span className="flex items-center gap-1">
                      {s.status !== "voided" && (
                        <Button size="sm" variant="ghost" icon={Ban} className="text-red-600" onClick={() => setVoiding(s)}>
                          Void
                        </Button>
                      )}
                      {/* Owners only: removes a test/junk sale entirely (see DeleteRecord.tsx). */}
                      <OwnerDeleteButton
                        compact
                        label="Delete sale"
                        title="Delete this sale permanently?"
                        description={`${money(s.total)} rung up ${timeAgo(s.created_at)}${s.staff_name ? ` by ${s.staff_name}` : ""}`}
                        consequences="It disappears from the journal and every report. Stock it took goes back on the shelf, and any amount put on a customer's account comes off. For a real sale entered wrongly, void it instead — that keeps the record."
                        run={(reason) => api.del(`/pos-sales/${s.id}`, { reason })}
                      />
                    </span>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!voiding}
        onClose={() => setVoiding(null)}
        size="sm"
        title="Void this sale?"
        description={voiding ? `${money(voiding.total)} rung up ${timeAgo(voiding.created_at)}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoiding(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={voidReason.trim().length < 3} loading={voidSale.isPending} onClick={() => voiding && voidSale.mutate(voiding)}>
              Void sale
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink/80">
            For a sale entered by mistake: the stock goes back and any credit charge is reversed. For a customer returning goods, adjust stock as a return
            instead.
          </p>
          <Field label="Why is it being voided?" hint="Recorded with your name — the owner sees it.">
            <Input autoFocus value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Rang up the wrong size" />
          </Field>
        </div>
      </Modal>
      {identifying && <IdentifyModal sale={identifying.sale} item={identifying.item} onClose={() => setIdentifying(null)} />}
      {breaking && <BreakDownModal sale={breaking.sale} item={breaking.item} onClose={() => setBreaking(null)} />}
    </Card>
  );
}

// Attaching the exact product to a quick-logged line: search (within its
// type), pick the product, then the size. Sizes without enough stock for
// the line's quantity are disabled. Stock comes off now; the price
// charged doesn't change.
function IdentifyModal({ sale, item, onClose }: { sale: PosSale; item: PosSaleItem; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const results = useQuery({
    queryKey: ["products", "identify", debounced, item.category_id],
    queryFn: () => api.list<Product>("/products", { search: debounced, category_id: item.category_id, limit: 12 }),
  });

  const attach = async (v: Variant) => {
    setError(null);
    try {
      await api.post(`/pos-sales/${sale.id}/items/${item.id}/identify`, { variant_id: v.id });
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["pos-sales"] })]);
      toast.success("Product attached — stock deducted");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal open onClose={onClose} title="Identify the product" description={`${item.quantity} × ${item.category_name} at ${money(item.unit_price)}${item.note ? ` — “${item.note}”` : ""}`}>
      <FormError message={error} />
      {!product ? (
        <>
          <Input autoFocus className="mb-3" placeholder={`Search ${item.category_name ?? ""}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {results.data?.rows.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setProduct(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-canvas">
                  <Thumb path={primaryImage(p)?.storage_path} size={36} />
                  <span className="font-medium">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="space-y-3">
          <p className="font-semibold">{product.name}</p>
          <div className="flex flex-wrap gap-2">
            {sortVariants(product.variants).map((v) => (
              <Button key={v.id} variant="secondary" disabled={v.stock_quantity < item.quantity} onClick={() => void attach(v)}>
                {variantLabel(v)} ({v.stock_quantity})
              </Button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>
            Choose a different product
          </Button>
        </div>
      )}
    </Modal>
  );
}

// --- breaking a line down -------------------------------------------------
//
// A one-amount ("unsorted") line, or a quick-logged line that turned out to
// be several different products, gets replaced by what was really in it.
// POST /pos-sales/{id}/items/{item_id}/break-down does the work; the rules
// it enforces, mirrored here so the button only lights up when they hold:
//   - the parts must add up to exactly what the line charged (the money was
//     already taken -- a breakdown only says what it paid for);
//   - a part names an exact product (its stock comes off now), or, if even
//     that isn't known, a type of item (it stays a quick-logged line to
//     identify later);
//   - there must be enough stock of each product named.

/** One part of the breakdown, as it's being edited. Prices are kept as the
 * text typed so a half-typed "12." doesn't get rewritten under the cursor. */
type Part =
  | { key: string; kind: "product"; product: Product; variant: Variant; quantity: number; price: string }
  | { key: string; kind: "type"; category: Category; quantity: number; price: string; note: string };

/** Money as whole pesewas, so sums compare exactly (0.1 + 0.2 === 0.3). */
const toPesewas = (cedis: number) => Math.round(cedis * 100);
const partPesewas = (p: Part) => toPesewas(Number(p.price) || 0) * p.quantity;

function BreakDownModal({ sale, item, onClose }: { sale: PosSale; item: PosSaleItem; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const categories = useCategories();
  const [parts, setParts] = useState<Part[]>([]);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  // The product whose sizes are showing, waiting for one to be picked.
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [typeId, setTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A quick-logged line already says what type of item it was, so start the
  // search there; a one-amount basket could be anything in the shop.
  const results = useQuery({
    queryKey: ["products", "break-down", debounced, item.category_id],
    queryFn: () => api.list<Product>("/products", { search: debounced, category_id: item.category_id, limit: 12 }),
  });

  const target = toPesewas(item.line_total);
  const allocated = parts.reduce((n, p) => n + partPesewas(p), 0);
  // Positive: still to account for. Negative: the parts come to too much.
  const remaining = target - allocated;
  // Units of each size already in the breakdown, so the stock shown (and
  // the most that can be added) accounts for parts already listed.
  const used = (variantId: string) => parts.reduce((n, p) => n + (p.kind === "product" && p.variant.id === variantId ? p.quantity : 0), 0);
  const ready = parts.length > 0 && remaining === 0 && parts.every((p) => p.quantity > 0 && Number(p.price) > 0);

  /** Starting price for a newly added product: what the till would have
   * charged for it (wholesale if the original line was wholesale), unless
   * that's more than what's left, in which case whatever is left. */
  const suggestedPrice = (product: Product, variant: Variant) => {
    const list = item.price_tier === "wholesale" ? (variant.wholesale_price ?? retailPrice(product, variant)) : retailPrice(product, variant);
    const left = remaining / 100;
    return (left > 0 && list > left ? left : list).toFixed(2);
  };

  const addProduct = (product: Product, variant: Variant) => {
    setParts((current) => {
      // Picking the same size twice adds one more of it rather than a
      // second row -- the server would merge them for stock anyway.
      const existing = current.find((p) => p.kind === "product" && p.variant.id === variant.id);
      if (existing) return current.map((p) => (p === existing ? { ...p, quantity: p.quantity + 1 } : p));
      return [...current, { key: nextKey(), kind: "product", product, variant, quantity: 1, price: suggestedPrice(product, variant) }];
    });
    setChoosing(null);
  };

  const addType = () => {
    const category = categories.data?.find((c) => c.id === typeId);
    if (!category) return;
    // Nothing to price a type of item from, so offer whatever is left.
    setParts((current) => [...current, { key: nextKey(), kind: "type", category, quantity: 1, price: remaining > 0 ? (remaining / 100).toFixed(2) : "", note: "" }]);
    setTypeId("");
  };

  const update = (key: string, change: Partial<{ quantity: number; price: string; note: string }>) =>
    setParts((current) => current.map((p) => (p.key === key ? ({ ...p, ...change } as Part) : p)));

  /** Re-prices one part so the breakdown balances: its price each becomes
   * (its own total + what's left) / its quantity. Only offered when that
   * divides evenly to the pesewa, so it never leaves a stray pesewa. */
  const absorbRest = (p: Part) => {
    const total = partPesewas(p) + remaining;
    if (total <= 0 || total % p.quantity !== 0) return null;
    return () => update(p.key, { price: (total / p.quantity / 100).toFixed(2) });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/pos-sales/${sale.id}/items/${item.id}/break-down`, {
        parts: parts.map((p) =>
          p.kind === "product"
            ? { variant_id: p.variant.id, quantity: p.quantity, unit_price: Number(p.price), price_tier: item.price_tier === "wholesale" ? "wholesale" : "retail" }
            : { category_id: p.category.id, quantity: p.quantity, unit_price: Number(p.price), price_tier: item.price_tier === "wholesale" ? "wholesale" : "retail", note: p.note.trim() || null },
        ),
      });
      // Stock moved, and the sale's lines changed (it may also have left
      // the "to sort out" list), so refresh both.
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["pos-sales"] })]);
      toast.success(parts.some((p) => p.kind === "product") ? "Sale broken down — stock deducted" : "Sale broken down");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={item.category_id ? `Split ${item.quantity} × ${item.category_name}` : "Break down this sale"}
      description={`${money(item.line_total)} rung up ${timeAgo(sale.created_at)}${sale.staff_name ? ` by ${sale.staff_name}` : ""}${item.note ? ` — “${item.note}”` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={busy} onClick={() => void submit()}>
            Save breakdown
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormError message={error} />

        {/* What's been accounted for so far. */}
        {parts.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {parts.map((p) => {
              const fill = remaining !== 0 ? absorbRest(p) : null;
              const max = p.kind === "product" ? p.variant.stock_quantity - used(p.variant.id) + p.quantity : undefined;
              return (
                <li key={p.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  {p.kind === "product" ? (
                    <Thumb path={primaryImage(p.product)?.storage_path} size={36} />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                      <Zap className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-40 flex-1">
                    <p className="font-semibold">{p.kind === "product" ? p.product.name : `${p.category.name} (quick log)`}</p>
                    {p.kind === "product" ? (
                      <p className="text-xs text-muted">
                        {variantLabel(p.variant)} · {p.variant.stock_quantity} in stock
                      </p>
                    ) : (
                      // A type of item stays to be identified later; a note helps.
                      <Input className="mt-1 h-8 text-xs" placeholder="Note (optional), e.g. colour or size" value={p.note} onChange={(e) => update(p.key, { note: e.target.value })} />
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    Qty
                    <Input
                      type="number"
                      min={1}
                      max={max}
                      className="h-9 w-16"
                      value={p.quantity}
                      onChange={(e) => update(p.key, { quantity: Math.max(1, Math.min(max ?? Infinity, Math.floor(Number(e.target.value) || 1))) })}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    Each ₵
                    <Input type="number" min={0.01} step="0.01" className="h-9 w-24" value={p.price} onChange={(e) => update(p.key, { price: e.target.value })} />
                  </label>
                  <span className="tabular w-24 text-right font-semibold">{money(partPesewas(p) / 100)}</span>
                  <span className="flex w-full justify-end gap-1 sm:w-auto">
                    {fill && (
                      <Button size="sm" variant="ghost" onClick={fill}>
                        Use the rest
                      </Button>
                    )}
                    <IconButton icon={Trash2} label="Remove part" onClick={() => setParts(parts.filter((x) => x.key !== p.key))} className="hover:text-red-600" />
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* Running balance: the same green/amber bar as the checkout. */}
        <div className={`flex justify-between rounded-lg px-3 py-2 text-sm font-semibold ${remaining === 0 && parts.length ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          <span>{remaining === 0 && parts.length ? "All accounted for" : remaining > 0 ? "Still to account for" : "Parts come to more than was taken"}</span>
          <span className="tabular">{money(Math.abs(remaining) / 100)}</span>
        </div>

        {/* Adding parts: an exact product, or just a type of item. */}
        <div className="grid gap-5 md:grid-cols-[1fr_15rem]">
          <div>
            <p className="mb-2 text-xs font-semibold text-ink/80">Add a product</p>
            {!choosing ? (
              <>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input autoFocus className="pl-9" placeholder={`Search ${item.category_name ?? "products"}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {results.data?.rows.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setChoosing(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-canvas">
                        <Thumb path={primaryImage(p)?.storage_path} size={32} />
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        <span className="text-xs text-muted">{totalStock(p)} in stock</span>
                      </button>
                    </li>
                  ))}
                  {results.data?.rows.length === 0 && <li className="p-3 text-sm text-muted">No products match.</li>}
                </ul>
              </>
            ) : (
              // Second step: which size. Sizes with nothing left to give
              // (counting parts already listed) are disabled.
              <div className="space-y-3 rounded-lg border border-line p-3">
                <p className="text-sm font-semibold">{choosing.name}</p>
                <div className="flex flex-wrap gap-2">
                  {sortVariants(choosing.variants.filter((v) => v.is_active)).map((v) => {
                    const left = v.stock_quantity - used(v.id);
                    return (
                      <Button key={v.id} size="sm" variant="secondary" disabled={left <= 0} onClick={() => addProduct(choosing, v)}>
                        {variantLabel(v)} ({left})
                      </Button>
                    );
                  })}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setChoosing(null)}>
                  Back to search
                </Button>
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-ink/80">Or just the type of item</p>
            <p className="mb-2 text-xs text-muted">Not sure of the exact product? Log the type now and identify it later.</p>
            <div className="flex gap-2">
              <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">Choose…</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" icon={Plus} disabled={!typeId} onClick={addType}>
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
