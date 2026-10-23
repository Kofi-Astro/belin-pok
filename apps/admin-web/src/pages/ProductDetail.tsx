import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ExternalLink, ImagePlus, PackagePlus, Pencil, Plus, Rocket, Star, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { ProductStatusBadge, StockBadge } from "@/components/bits";
import { ConfirmDialog, Modal, useToast } from "@/components/overlay";
import { AdjustStockModal, ReceiveStockModal } from "@/components/StockModals";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconButton,
  Input,
  PageHeader,
  PageLoading,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  Toggle,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime, imageUrl, money, sortVariants, titleCase, totalStock, variantLabel } from "@/lib/format";
import { onlinePrice, useShopSettings } from "@/lib/pricing";
import { useCategories } from "@/lib/queries";
import type { AuditEntry, Product, Variant } from "@/lib/types";

const STOREFRONT_URL = (import.meta.env.VITE_STOREFRONT_URL ?? "https://belpok.xyz").replace(/\/$/, "");

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const product = useQuery({ queryKey: ["product", id], queryFn: () => api.get<Product>(`/products/${id}`) });
  const shopSettings = useShopSettings();

  const [adjusting, setAdjusting] = useState<Variant | null>(null);
  const [editingVariant, setEditingVariant] = useState<Variant | "new" | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["product", id] }), qc.invalidateQueries({ queryKey: ["products"] })]);

  const setStatus = useMutation({
    mutationFn: (status: Product["status"]) => api.patch<Product>(`/products/${id}`, { status }),
    onSuccess: async (p) => {
      await refresh();
      toast.success(p.status === "active" ? "Published — it's live on the shop and the till" : `Moved to ${p.status === "draft" ? "drafts" : "archive"}`);
    },
    // e.g. "Set a price for this product before publishing it"
    onError: (e) => toast.error(e),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/products/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product deleted");
      navigate("/products");
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast.error(e);
    },
  });

  if (product.isPending) return <PageLoading />;
  if (product.isError) return <ErrorState error={product.error} />;
  const p = product.data;
  const stock = totalStock(p);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/products" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Products
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {p.name} <ProductStatusBadge status={p.status} />
          </span>
        }
        actions={
          can.manageCatalog && (
            <>
              <Button variant="secondary" icon={PackagePlus} onClick={() => setReceiving(true)}>
                Receive stock
              </Button>
              {p.status !== "active" && (
                <Button icon={Rocket} loading={setStatus.isPending} onClick={() => setStatus.mutate("active")}>
                  Publish
                </Button>
              )}
              {p.status === "active" && (
                <Button variant="secondary" icon={Undo2} onClick={() => setStatus.mutate("draft")}>
                  Unpublish
                </Button>
              )}
              {p.status !== "archived" && (
                <Button variant="secondary" icon={Archive} onClick={() => setStatus.mutate("archived")}>
                  Archive
                </Button>
              )}
              <IconButton icon={Trash2} label="Delete product" onClick={() => setConfirmDelete(true)} className="hover:text-red-600" />
            </>
          )
        }
      />

      {p.status === "draft" && p.base_price === 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Received at the counter and still a placeholder: set a price and category below, then <b>Publish</b> to start selling it.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <DetailsCard product={p} editable={can.manageCatalog} onSaved={refresh} />

          <Card>
            <CardHeader
              title="Sizes & colours"
              description="Each is its own SKU with its own stock and prices."
              actions={
                can.manageCatalog && (
                  <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditingVariant("new")}>
                    Add
                  </Button>
                )
              }
            />
            {p.variants.length === 0 ? (
              <EmptyState icon={Plus} title="No sizes yet" message="Add at least one size so this product can hold stock." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Variant</Th>
                    <Th className="text-right">In store</Th>
                    <Th className="text-right">Online</Th>
                    <Th className="text-right">Wholesale</Th>
                    <Th className="text-right">Pack</Th>
                    <Th>Stock</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {sortVariants(p.variants).map((v) => (
                    <tr key={v.id} className={v.is_active ? "" : "opacity-50"}>
                      <Td>
                        <div className="flex items-center gap-2 font-medium whitespace-nowrap">
                          {v.color_hex && <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: v.color_hex }} />}
                          {variantLabel(v)}
                          {!v.is_active && <Badge>Hidden</Badge>}
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-muted">{v.sku}</p>
                      </Td>
                      <Td className="tabular text-right">{money(v.price_override ?? p.base_price)}</Td>
                      <Td className="tabular text-right whitespace-nowrap">
                        {(() => {
                          const online = onlinePrice(p, v, shopSettings.data);
                          return online === null ? "…" : (
                            <span title={v.online_price !== null ? "Fixed online price" : "In-store price + online markup"}>
                              {money(online)}
                              {v.online_price !== null && <span className="ml-1 text-[10px] font-semibold text-brand-600 uppercase">fixed</span>}
                            </span>
                          );
                        })()}
                      </Td>
                      <Td className="tabular text-right">{v.wholesale_price !== null ? money(v.wholesale_price) : <span className="text-muted">—</span>}</Td>
                      <Td className="tabular text-right whitespace-nowrap">
                        {v.pack_price !== null ? (
                          <span>
                            {money(v.pack_price)} <span className="text-xs text-muted">/ {v.pack_size}</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                      <Td>
                        <StockBadge variant={v} />
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {can.adjustStock && (
                          <Button size="sm" variant="ghost" onClick={() => setAdjusting(v)}>
                            Adjust
                          </Button>
                        )}
                        {can.manageCatalog && <IconButton icon={Pencil} label="Edit variant" onClick={() => setEditingVariant(v)} />}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <PhotosCard product={p} editable={can.manageCatalog} onChanged={refresh} />
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">In stock</p>
            <p className="tabular mt-2 text-3xl font-bold">{stock}</p>
            <p className="mt-1 text-sm text-muted">
              across {p.variants.length} variant{p.variants.length === 1 ? "" : "s"}
              {p.variants.filter((v) => v.stock_quantity === 0).length > 0 &&
                ` · ${p.variants.filter((v) => v.stock_quantity === 0).length} sold out`}
            </p>
            {p.status === "active" && (
              <a
                href={`${STOREFRONT_URL}/products/${p.slug}`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
              >
                View on the shop <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </Card>
          <HistoryCard productId={p.id} />
        </div>
      </div>

      <AdjustStockModal open={!!adjusting} onClose={() => setAdjusting(null)} variant={adjusting} productName={p.name} />
      <VariantModal product={p} variant={editingVariant} onClose={() => setEditingVariant(null)} onSaved={refresh} />
      <ReceiveStockModal open={receiving} onClose={() => setReceiving(false)} product={p} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        busy={remove.isPending}
        danger
        title="Delete this product?"
        confirmLabel="Delete"
        message="This can't be undone. If it has ever been sold or had stock recorded, deleting is blocked — archive it instead."
      />
    </>
  );
}

function DetailsCard({ product, editable, onSaved }: { product: Product; editable: boolean; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const categories = useCategories();
  const initial = () => ({
    name: product.name,
    category_id: product.category_id,
    brand: product.brand ?? "",
    base_price: product.base_price === 0 ? "" : String(product.base_price),
    description: product.description ?? "",
  });
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(initial()), [product.updated_at]);

  const set = (k: keyof ReturnType<typeof initial>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  // Only what changed is sent, so the change history shows just that.
  const changes: Record<string, unknown> = {};
  if (form.name.trim() !== product.name) changes.name = form.name.trim();
  if (form.category_id !== product.category_id) changes.category_id = form.category_id;
  if ((form.brand.trim() || null) !== product.brand) changes.brand = form.brand.trim() || null;
  if (Number(form.base_price || 0) !== product.base_price) changes.base_price = Number(form.base_price || 0);
  if ((form.description.trim() || null) !== product.description) changes.description = form.description.trim() || null;
  const dirty = Object.keys(changes).length > 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/products/${product.id}`, changes);
      await onSaved();
      toast.success("Details saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Details" />
      <form onSubmit={save} className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        <Field label="Name" className="sm:col-span-2">
          <Input disabled={!editable} required value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Category">
          <Select disabled={!editable} value={form.category_id} onChange={set("category_id")}>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="In-store price (GH₵)" hint="What the till charges, for every size without its own price. Online adds the shop's markup.">
          <Input disabled={!editable} type="number" min={0} step="0.01" value={form.base_price} onChange={set("base_price")} />
        </Field>
        <Field label="Brand" className="sm:col-span-2">
          <Input disabled={!editable} value={form.brand} onChange={set("brand")} />
        </Field>
        <Field label="Description" hint="Shown on the product page of the shop." className="sm:col-span-2">
          <Textarea disabled={!editable} value={form.description} onChange={set("description")} />
        </Field>
        {editable && (
          <div className="flex justify-end gap-2 sm:col-span-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setForm(initial())}>
                Discard
              </Button>
            )}
            <Button type="submit" disabled={!dirty} loading={busy}>
              Save changes
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

/** Create a size/colour, or edit one's pricing, low-stock alert level, and
 * whether it's shown at all. Stock itself only changes through movements. */
function VariantModal({
  product,
  variant,
  onClose,
  onSaved,
}: {
  product: Product;
  variant: Variant | "new" | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const toast = useToast();
  const isNew = variant === "new";
  const v = isNew ? null : variant;
  const blank = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  const [form, setForm] = useState({
    size: "",
    color: "",
    color_hex: "",
    price_override: "",
    wholesale_price: "",
    pack_price: "",
    pack_size: "",
    online_price: "",
    low_stock_threshold: "5",
    is_active: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!variant) return;
    setError(null);
    setForm({
      size: v?.size ?? "",
      color: v?.color ?? "",
      color_hex: v?.color_hex ?? "",
      price_override: blank(v?.price_override),
      wholesale_price: blank(v?.wholesale_price),
      pack_price: blank(v?.pack_price),
      pack_size: blank(v?.pack_size),
      online_price: blank(v?.online_price),
      low_stock_threshold: blank(v?.low_stock_threshold ?? 5),
      is_active: v?.is_active ?? true,
    });
  }, [variant]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((form.pack_price === "") !== (form.pack_size === "")) return setError("Pack price and units per pack go together — fill both or neither.");
    const body = {
      size: form.size.trim(),
      color: form.color.trim() || null,
      color_hex: form.color_hex || null,
      price_override: num(form.price_override),
      wholesale_price: num(form.wholesale_price),
      pack_price: num(form.pack_price),
      pack_size: num(form.pack_size),
      online_price: num(form.online_price),
      low_stock_threshold: Number(form.low_stock_threshold || 0),
      is_active: form.is_active,
    };
    setBusy(true);
    setError(null);
    try {
      if (isNew) await api.post(`/products/${product.id}/variants`, body);
      else await api.patch(`/variants/${v!.id}`, body);
      await onSaved();
      toast.success(isNew ? "Variant added — SKU generated automatically" : "Variant saved");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!variant}
      onClose={onClose}
      title={isNew ? "Add a size / colour" : `Edit ${v ? variantLabel(v) : ""}`}
      description={v ? `SKU ${v.sku}` : "A SKU is generated for you."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="variant-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="variant-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        <Field label="Size">
          <Input required value={form.size} onChange={set("size")} placeholder="e.g. M, 32, One Size" />
        </Field>
        <Field label="Colour">
          <div className="flex gap-2">
            <Input value={form.color} onChange={set("color")} placeholder="e.g. Black" />
            <input
              type="color"
              aria-label="Colour swatch"
              value={form.color_hex || "#000000"}
              onChange={(e) => setForm({ ...form, color_hex: e.target.value.toUpperCase() })}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1"
            />
          </div>
        </Field>
        <Field label="In-store price (GH₵)" hint={`Blank = product price (${money(product.base_price)})`}>
          <Input type="number" min={0} step="0.01" value={form.price_override} onChange={set("price_override")} />
        </Field>
        <Field label="Wholesale price (GH₵)" hint="Per unit. Blank = retail price.">
          <Input type="number" min={0} step="0.01" value={form.wholesale_price} onChange={set("wholesale_price")} />
        </Field>
        <Field label="Online price (GH₵)" hint="Blank = in-store price + the shop's online markup (Shop settings).">
          <Input type="number" min={0} step="0.01" value={form.online_price} onChange={set("online_price")} />
        </Field>
        <Field label="Pack price (GH₵)" hint="For a whole factory pack.">
          <Input type="number" min={0} step="0.01" value={form.pack_price} onChange={set("pack_price")} />
        </Field>
        <Field label="Units per pack">
          <Input type="number" min={1} value={form.pack_size} onChange={set("pack_size")} />
        </Field>
        <Field label="Low-stock alert at" hint="Flagged as running low at or below this.">
          <Input type="number" min={0} value={form.low_stock_threshold} onChange={set("low_stock_threshold")} />
        </Field>
        {!isNew && (
          <div className="flex items-center justify-between rounded-lg border border-line px-3 sm:mt-6">
            <span className="text-sm font-medium">Shown on shop &amp; till</span>
            <Toggle checked={form.is_active} onChange={(on) => setForm({ ...form, is_active: on })} label="Shown on shop and till" />
          </div>
        )}
      </form>
    </Modal>
  );
}

function PhotosCard({ product, editable, onChanged }: { product: Product; editable: boolean; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const ordered = [...product.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order);

  const upload = async (files: FileList) => {
    setUploading(true);
    try {
      for (const [i, file] of [...files].entries()) {
        const path = await api.uploadPhoto(file);
        await api.post(`/products/${product.id}/images`, { storage_path: path, is_primary: product.images.length === 0 && i === 0 });
      }
      await onChanged();
      toast.success(files.length === 1 ? "Photo added" : `${files.length} photos added`);
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      await onChanged();
      toast.success(msg);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Photos"
        description="The cover photo is what shoppers see first."
        actions={
          editable && (
            <Button size="sm" variant="secondary" icon={ImagePlus} loading={uploading} onClick={() => fileRef.current?.click()}>
              Upload
            </Button>
          )
        }
      />
      <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.length && void upload(e.target.files)} />
      {ordered.length === 0 ? (
        <EmptyState icon={ImagePlus} title="No photos yet" message="Products with photos sell far better online." />
      ) : (
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          {ordered.map((img) => (
            <div key={img.id} className="group relative aspect-[4/5] overflow-hidden rounded-xl bg-canvas ring-1 ring-line">
              <img src={imageUrl(img.storage_path)} alt="" className="h-full w-full object-cover" />
              {img.is_primary && (
                <span className="absolute top-2 left-2">
                  <Badge tone="brand">Cover</Badge>
                </span>
              )}
              {editable && (
                <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                  {!img.is_primary && (
                    <IconButton
                      icon={Star}
                      label="Make cover photo"
                      className="bg-white shadow"
                      onClick={() => void act(() => api.patch(`/images/${img.id}`, {}), "Cover photo updated")}
                    />
                  )}
                  <IconButton
                    icon={Trash2}
                    label="Delete photo"
                    className="bg-white shadow hover:text-red-600"
                    onClick={() => void act(() => api.del(`/images/${img.id}`), "Photo deleted")}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function HistoryCard({ productId }: { productId: string }) {
  const { can } = useAuth();
  const log = useQuery({
    queryKey: ["audit", productId],
    queryFn: () => api.get<AuditEntry[]>("/audit-log", { table_name: "products", record_id: productId, limit: 30 }),
    enabled: can.isOwner, // the audit log is owner-only on the API
  });
  if (!can.isOwner) return null;
  return (
    <Card>
      <CardHeader title="Change history" />
      {!log.data?.length ? (
        <p className="p-5 text-sm text-muted">No changes recorded.</p>
      ) : (
        <ol className="space-y-4 p-5">
          {log.data.map((e) => {
            const fields = Object.keys(e.new_values ?? e.old_values ?? {}).filter(
              (k) => JSON.stringify(e.old_values?.[k]) !== JSON.stringify(e.new_values?.[k]),
            );
            return (
              <li key={e.id} className="relative border-l-2 border-line pl-4 text-sm">
                <span className="absolute top-1.5 -left-[5px] h-2 w-2 rounded-full bg-brand-500" />
                <p className="font-medium">
                  {e.action === "product.create" ? "Created" : e.action === "product.delete" ? "Deleted" : `Changed ${fields.map(titleCase).join(", ")}`}
                </p>
                <p className="text-xs text-muted">
                  {e.staff_name ?? "Someone"} · {dateTime(e.created_at)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
