// The product catalogue: every product, searchable and filterable by
// status (live / drafts / archived) and category, with price and stock at
// a glance. Two ways to add products:
//   - Receive stock: the fast path for a delivery -- name, photo and
//     quantity, creating a draft to price later (components/StockModals);
//   - New product: the full form, for setting a product up properly first.
// Clicking a row opens the product's own page (ProductDetail.tsx).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PackagePlus, Plus, Search, Shirt } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ProductStatusBadge, Thumb } from "@/components/bits";
import { Modal, useToast } from "@/components/overlay";
import { ReceiveStockModal } from "@/components/StockModals";
import { Button, Card, EmptyState, ErrorState, Field, FormError, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, money, primaryImage, slugify, totalStock } from "@/lib/format";
import { applyMarkup, useShopSettings } from "@/lib/pricing";
import { useCategories, useDebounced } from "@/lib/queries";
import type { Product, ProductStatus } from "@/lib/types";

// Products per page.
const PAGE_SIZE = 25;
// Status filter tabs; "Live" is the API's "active".
const STATUS_TABS: { value: ProductStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Live" },
  { value: "draft", label: "Drafts" },
  { value: "archived", label: "Archived" },
];

export function ProductsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const categories = useCategories();
  // For the "Online from" hint under each price.
  const shopSettings = useShopSettings();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<ProductStatus | "">("");
  const [page, setPage] = useState(0);
  const [receiving, setReceiving] = useState(false);
  const [creating, setCreating] = useState(false);

  const products = useQuery({
    queryKey: ["products", { debounced, categoryId, status, page }],
    queryFn: () =>
      api.list<Product>("/products", { search: debounced, category_id: categoryId, status, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  // Category id -> name, from the cached category list.
  const categoryName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? "—";

  // The in-store price, or a range when sizes are priced differently, with
  // the cheapest online price underneath when the shop has a markup set.
  // A draft at ₵0 is a fast-received item that hasn't been priced yet.
  const priceCell = (p: Product) => {
    const prices = p.variants.map((v) => v.price_override ?? p.base_price);
    const min = Math.min(p.base_price, ...prices);
    const max = Math.max(p.base_price, ...prices);
    if (p.base_price === 0 && p.status === "draft") return <span className="text-amber-700">No price yet</span>;
    const s = shopSettings.data;
    return (
      <>
        {min === max ? money(min) : `${money(min)} – ${money(max)}`}
        {s && s.online_markup_percent > 0 && <span className="block text-xs font-normal text-muted">Online from {money(applyMarkup(min, s))}</span>}
      </>
    );
  };

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything in the catalogue — live on the shop, drafts waiting for a price, and archived lines."
        actions={
          can.manageCatalog && (
            <>
              <Button variant="secondary" icon={PackagePlus} onClick={() => setReceiving(true)}>
                Receive stock
              </Button>
              <Button icon={Plus} onClick={() => setCreating(true)}>
                New product
              </Button>
            </>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="flex rounded-lg bg-canvas p-0.5">
            {STATUS_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  setStatus(t.value);
                  setPage(0);
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${status === t.value ? "bg-white shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-48 flex-[1_1_16rem]">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              className="pl-9"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <Select
            className="w-48"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {products.isFetching && <Spinner className="h-4 w-4" />}
        </div>

        {products.isError ? (
          <div className="p-4">
            <ErrorState error={products.error} />
          </div>
        ) : products.data?.rows.length === 0 ? (
          <EmptyState
            icon={Shirt}
            title={debounced || categoryId || status ? "No products match" : "No products yet"}
            message={debounced || categoryId || status ? "Try a different search or filter." : "Receive a delivery or add your first product."}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>Category</Th>
                  <Th>Status</Th>
                  <Th className="text-right">In-store price</Th>
                  <Th className="text-right">Stock</Th>
                  <Th>Updated</Th>
                </tr>
              </thead>
              <tbody>
                {(products.data?.rows ?? []).map((p) => {
                  const stock = totalStock(p);
                  return (
                    <tr key={p.id} onClick={() => navigate(`/products/${p.id}`)} className="cursor-pointer hover:bg-canvas/70">
                      <Td>
                        <div className="flex items-center gap-3">
                          <Thumb path={primaryImage(p)?.storage_path} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{p.name}</p>
                            <p className="text-xs text-muted">
                              {p.variants.length} variant{p.variants.length === 1 ? "" : "s"}
                              {p.brand ? ` · ${p.brand}` : ""}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-muted">{categoryName(p.category_id)}</Td>
                      <Td>
                        <ProductStatusBadge status={p.status} />
                        {/* Live with nothing to buy -- see the product page's warning. */}
                        {p.status === "active" && p.variants.length === 0 && <p className="mt-1 text-xs font-semibold text-amber-700">No sizes yet</p>}
                      </Td>
                      <Td className="tabular text-right font-medium">{priceCell(p)}</Td>
                      {/* Red: nothing left. Amber: some size is at or below its alert level. */}
                      <Td className={`tabular text-right font-semibold ${stock === 0 ? "text-red-600" : p.variants.some((v) => v.stock_quantity <= v.low_stock_threshold) ? "text-amber-700" : ""}`}>
                        {stock}
                      </Td>
                      <Td className="whitespace-nowrap text-muted">{date(p.updated_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={products.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>

      <ReceiveStockModal open={receiving} onClose={() => setReceiving(false)} />
      <NewProductModal open={creating} onClose={() => setCreating(false)} onCreated={(p) => navigate(`/products/${p.id}`)} />
    </>
  );
}

/** The full "new product" form (vs. Receive stock's quick path): name,
 * category and price up front, created as a draft; sizes, photos and
 * stock are added on the product's page next. */
function NewProductModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Product) => void }) {
  const toast = useToast();
  const categories = useCategories();
  const [form, setForm] = useState({ name: "", category_id: "", brand: "", base_price: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Created as a draft (the API's default), so it isn't sold anywhere
      // until it has sizes and is published. The slug is the URL-friendly
      // name the website uses (/products/<slug>).
      const p = await api.post<Product>("/products", {
        name: form.name.trim(),
        slug: slugify(form.name),
        category_id: form.category_id,
        brand: form.brand.trim() || null,
        base_price: Number(form.base_price),
        description: form.description.trim() || null,
      });
      toast.success(`${p.name} created as a draft`);
      setForm({ name: "", category_id: "", brand: "", base_price: "", description: "" });
      onCreated(p);
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
      title="New product"
      description="Add sizes, photos and stock on the next screen."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-product" loading={busy}>
            Create product
          </Button>
        </>
      }
    >
      <form id="new-product" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        <Field label="Name" className="sm:col-span-2">
          <Input autoFocus required value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Category">
          <Select required value={form.category_id} onChange={set("category_id")}>
            <option value="">Choose…</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price (GH₵)">
          <Input type="number" required min={0} step="0.01" value={form.base_price} onChange={set("base_price")} />
        </Field>
        <Field label="Brand (optional)" className="sm:col-span-2">
          <Input value={form.brand} onChange={set("brand")} />
        </Field>
      </form>
    </Modal>
  );
}
