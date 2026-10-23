// Stock-changing dialogs used from several screens: adjusting one SKU's
// stock, and receiving a delivery (new item or more of an existing one).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronDown, PackagePlus, Search } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "@/lib/api";
import { primaryImage, sortVariants, variantLabel } from "@/lib/format";
import { useCategories, useDebounced } from "@/lib/queries";
import type { MovementType, Product, StockIntakeResult, Variant } from "@/lib/types";

import { Thumb } from "./bits";
import { Modal, useToast } from "./overlay";
import { Button, Field, FormError, Input, Select } from "./ui";

/** Refetch everything that shows stock after a change. */
export function useInvalidateStock() {
  const qc = useQueryClient();
  return () =>
    // Every cached query whose screen shows stock somewhere (categories:
    // the product counts on the Categories page).
    Promise.all(
      ["products", "product", "inventory", "low-stock", "movements", "dashboard", "categories"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
}

// What a manual stock change can be. sign: +1 adds the quantity typed, -1
// removes it, 0 takes it as typed (a correction can go either way).
// "initial" isn't offered -- it's only for opening stock.
const MOVEMENTS: { value: MovementType; label: string; sign: 1 | -1 | 0; hint: string }[] = [
  { value: "restock", label: "Restock (stock in)", sign: 1, hint: "A delivery or new stock arriving." },
  { value: "adjustment", label: "Correction (+ or −)", sign: 0, hint: "Counted stock doesn't match — enter the difference." },
  { value: "return", label: "Customer return", sign: 1, hint: "Goods coming back into stock." },
  { value: "sale", label: "Sale not rung up", sign: -1, hint: "Sold without the till — prefer Point of sale." },
];

/** One stock movement for one SKU (POST /stock-movements). Every change is
 * a ledger row, so the reason is worth filling in. */
export function AdjustStockModal({
  open,
  onClose,
  variant,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  variant: Variant | null;
  productName: string;
}) {
  const toast = useToast();
  const invalidate = useInvalidateStock();
  const [type, setType] = useState<MovementType>("restock");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The chosen kind, and the signed change it makes to stock.
  const movement = MOVEMENTS.find((m) => m.value === type)!;

  if (!variant) return null;
  const n = parseInt(qty, 10);
  const change = Number.isNaN(n) ? 0 : movement.sign === 0 ? n : movement.sign * Math.abs(n);
  const after = variant.stock_quantity + change;

  // Clear the form on the way out, so the next SKU starts fresh.
  const close = () => {
    setQty("");
    setReason("");
    setError(null);
    setType("restock");
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!change) return setError("Enter a quantity other than zero.");
    // The API refuses negative stock too; this just says so sooner.
    if (after < 0) return setError(`That would take stock below zero (only ${variant.stock_quantity} on hand).`);
    setBusy(true);
    setError(null);
    try {
      await api.post("/stock-movements", { variant_id: variant.id, movement_type: type, quantity_change: change, reason: reason.trim() || null });
      await invalidate();
      toast.success(`Stock updated: ${productName} (${variantLabel(variant)}) now ${after}`);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Adjust stock"
      description={`${productName} · ${variantLabel(variant)} · SKU ${variant.sku}`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="adjust-stock" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="adjust-stock" onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="What happened" hint={movement.hint}>
          <Select value={type} onChange={(e) => setType(e.target.value as MovementType)}>
            {MOVEMENTS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={movement.sign === 0 ? "Change (use − to remove)" : "Quantity"}>
          <Input type="number" inputMode="numeric" autoFocus required value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier delivery, stock count" />
        </Field>
        {/* Now / Change / After preview, so a typo is obvious before saving. */}
        <div className="grid grid-cols-3 rounded-lg bg-canvas p-3 text-center text-sm">
          <div>
            <p className="text-xs text-muted">Now</p>
            <p className="tabular font-semibold">{variant.stock_quantity}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Change</p>
            <p className={`tabular font-semibold ${change > 0 ? "text-emerald-600" : change < 0 ? "text-red-600" : ""}`}>
              {change > 0 ? "+" : ""}
              {change}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">After</p>
            <p className={`tabular font-semibold ${after < 0 ? "text-red-600" : ""}`}>{after}</p>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Logging a delivery (POST /products/receive): a brand-new item needs only
 * a photo, name and quantity -- it lands as a draft in "Uncategorized" at
 * ₵0 unless more details are given, and can't be sold until priced and
 * published. Or more stock for an item already in the catalogue, including
 * a size/colour it didn't have. Stays open after saving, for the next item
 * in the delivery. */
export function ReceiveStockModal({ open, onClose, product: fixedProduct }: { open: boolean; onClose: () => void; product?: Product }) {
  const toast = useToast();
  const invalidate = useInvalidateStock();
  const categories = useCategories();
  // "new": an item not in the catalogue yet. "existing": more of something
  // that is. Opened from a product's own page (fixedProduct), it's always
  // that product.
  const [mode, setMode] = useState<"new" | "existing">(fixedProduct ? "existing" : "new");
  const fileRef = useRef<HTMLInputElement>(null);

  // New item: its photo (a local preview url, plus the storage path once
  // uploaded), name, quantity, and the optional extra details.
  const [photo, setPhoto] = useState<{ url: string; path: string | null; uploading: boolean } | null>(null);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [more, setMore] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");

  // Existing item: the product search, the product chosen, and which of
  // its sizes ("new" = a size/colour it doesn't have yet).
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [picked, setPicked] = useState<Product | null>(fixedProduct ?? null);
  const [variantId, setVariantId] = useState<string>("new");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A confirmation of the last item saved, kept on screen while the next
  // one is entered.
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ["products", "receive-search", debounced],
    queryFn: () => api.list<Product>("/products", { search: debounced, limit: 8 }),
    enabled: mode === "existing" && !picked && debounced.length > 0,
  });

  // Clears the item fields for the next one -- but not the mode, and not
  // the chosen product when the dialog belongs to one product.
  const reset = () => {
    setPhoto(null);
    setName("");
    setQty("");
    setCategoryId("");
    setPrice("");
    setSize("");
    setColor("");
    setSearch("");
    if (!fixedProduct) setPicked(null);
    setVariantId("new");
    setError(null);
  };

  const close = () => {
    reset();
    setLastSaved(null);
    onClose();
  };

  const pickPhoto = async (file: File) => {
    // Uploaded immediately, so saving the item is one quick request later.
    setPhoto({ url: URL.createObjectURL(file), path: null, uploading: true });
    try {
      const path = await api.uploadPhoto(file);
      setPhoto((p) => p && { ...p, path, uploading: false });
    } catch (err) {
      setPhoto(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Search results don't carry full variant details, so fetch the product.
  // With a single size, pre-select it.
  const selectProduct = async (p: Product) => {
    const full = await api.get<Product>(`/products/${p.id}`);
    setPicked(full);
    const active = full.variants.filter((v) => v.is_active);
    setVariantId(active.length === 1 ? active[0].id : "new");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const quantity = parseInt(qty, 10);
    if (!quantity || quantity <= 0) return setError("Enter how many came in.");
    let body: Record<string, unknown>;
    // A new item needs a name and a photo (so it can be recognised later on
    // the till and in the catalogue); the rest is optional. The API creates a
    // draft product with one variant and records the stock as received.
    if (mode === "new") {
      if (!name.trim()) return setError("Enter the item's name.");
      if (!photo?.path) return setError(photo?.uploading ? "The photo is still uploading — one moment." : "Add a photo of the item.");
      body = {
        name: name.trim(),
        image_storage_path: photo.path,
        quantity,
        category_id: categoryId || null,
        base_price: price ? Number(price) : null,
        size: size.trim() || null,
        color: color.trim() || null,
      };
    } else {
      if (!picked) return setError("Choose the item first.");
      // An existing size is identified by its size/colour; a new one is
      // created by the API from what was typed.
      const v = picked.variants.find((x) => x.id === variantId);
      body = { product_id: picked.id, quantity, size: v ? v.size : size.trim() || null, color: v ? v.color : color.trim() || null };
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<StockIntakeResult>("/products/receive", body);
      await invalidate();
      const label = `+${quantity} ${r.product.name} (${variantLabel(r.variant)}) — ${r.variant.stock_quantity} in stock`;
      setLastSaved(label);
      toast.success(r.created_product ? `${r.product.name} added as a draft` : "Stock received");
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const variantsOfPicked = sortVariants(picked?.variants.filter((v) => v.is_active) ?? []);

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Receive stock"
      description="Log goods coming in. Save each item and carry on with the next."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Done
          </Button>
          <Button type="submit" form="receive-stock" loading={busy} icon={PackagePlus}>
            Save &amp; next
          </Button>
        </>
      }
    >
      <form id="receive-stock" onSubmit={submit} className="space-y-4">
        {!fixedProduct && (
          <div className="grid grid-cols-2 rounded-lg bg-canvas p-1 text-sm font-semibold">
            {(["new", "existing"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`rounded-md py-2 ${mode === m ? "bg-white shadow-sm" : "text-muted"}`}
              >
                {m === "new" ? "New item" : "Already in catalogue"}
              </button>
            ))}
          </div>
        )}

        {/* Confirmation of the item just saved, while entering the next. */}
        {lastSaved && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">✓ {lastSaved}</p>}
        <FormError message={error} />

        {mode === "new" ? (
          <>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative flex h-28 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-line bg-canvas text-muted hover:border-brand-500"
              >
                {photo ? (
                  <img src={photo.url} alt="" className={`h-full w-full object-cover ${photo.uploading ? "opacity-50" : ""}`} />
                ) : (
                  <span className="flex flex-col items-center gap-1 text-xs font-semibold">
                    <Camera className="h-5 w-5" /> Photo
                  </span>
                )}
              </button>
              {/* capture="environment": opens the back camera on phones and tablets. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void pickPhoto(e.target.files[0])}
              />
              <div className="flex-1 space-y-3">
                <Field label="Item name">
                  <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Black Oversized Tee" />
                </Field>
                <Field label="How many came in?">
                  <Input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
                </Field>
              </div>
            </div>
            {/* Category, price, size and colour can be set now or later. */}
            <button type="button" onClick={() => setMore(!more)} className="flex items-center gap-1 text-sm font-semibold text-brand-700">
              <ChevronDown className={`h-4 w-4 transition ${more ? "rotate-180" : ""}`} /> More details (optional)
            </button>
            {more && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Category">
                  <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Decide later</option>
                    {/* "Uncategorized" is where items go by default -- not a real choice. */}
                    {categories.data
                      ?.filter((c) => c.slug !== "uncategorized")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Price (GH₵)">
                  <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
                <Field label="Size">
                  <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="One Size" />
                </Field>
                <Field label="Colour">
                  <Input value={color} onChange={(e) => setColor(e.target.value)} />
                </Field>
              </div>
            )}
            <p className="text-xs text-muted">Saved as a draft — it stays off the shop and the till until it&apos;s priced and published.</p>
          </>
        ) : !picked ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input autoFocus className="pl-9" placeholder="Search products by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {/* empty:hidden -- no empty bordered box before anything is typed. */}
            <ul className="divide-y divide-line rounded-lg border border-line empty:hidden">
              {results.data?.rows.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => void selectProduct(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-canvas">
                    <Thumb path={primaryImage(p)?.storage_path} size={36} />
                    <span className="flex-1 font-medium">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-line p-3">
              <Thumb path={primaryImage(picked)?.storage_path} size={44} />
              <span className="flex-1 font-semibold">{picked.name}</span>
              {!fixedProduct && (
                <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                  Change
                </Button>
              )}
            </div>
            <Field label="Which size / colour?">
              <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                {variantsOfPicked.map((v) => (
                  <option key={v.id} value={v.id}>
                    {variantLabel(v)} — {v.stock_quantity} in stock
                  </option>
                ))}
                <option value="new">A new size / colour…</option>
              </Select>
            </Field>
            {variantId === "new" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Size">
                  <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="One Size" />
                </Field>
                <Field label="Colour">
                  <Input value={color} onChange={(e) => setColor(e.target.value)} />
                </Field>
              </div>
            )}
            <Field label="How many came in?">
              <Input type="number" inputMode="numeric" min={1} autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
