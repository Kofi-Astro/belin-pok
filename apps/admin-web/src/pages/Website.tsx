// The Website page: changes what shoppers see on the storefront (belpok.xyz)
// without touching code -- the announcement strip, the home page banner
// (words, buttons, photos), selling points, a hand-picked Featured row,
// which home sections show, the wholesale section, footer text, contact
// details and social links. For owners and inventory managers.
//
// Everything is edited as one draft and saved together (PUT /storefront --
// see services/api/app/routers/storefront.py, which validates it and keeps
// the defaults). The website re-reads it at most a minute later. The
// products themselves, their prices and photos are managed on Products.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Thumb } from "@/components/bits";
import { useToast } from "@/components/overlay";
import { Button, Card, CardHeader, ErrorState, Field, FormError, IconButton, Input, PageHeader, PageLoading, Select, Textarea, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime, imageUrl, primaryImage } from "@/lib/format";
import { imageFiles, uploadPhotos } from "@/lib/photos";
import { useDebounced } from "@/lib/queries";
import type { HighlightIcon, Product, StorefrontContent, StorefrontContentRead } from "@/lib/types";

const STOREFRONT_URL = (import.meta.env.VITE_STOREFRONT_URL ?? "https://belpok.xyz").replace(/\/$/, "");

// Icon choices for the selling points, as the website draws them.
const ICONS: { value: HighlightIcon; label: string }[] = [
  { value: "store", label: "Shop" },
  { value: "truck", label: "Delivery van" },
  { value: "boxes", label: "Boxes" },
  { value: "bell", label: "Bell" },
  { value: "tag", label: "Price tag" },
  { value: "shield", label: "Shield (guarantee)" },
  { value: "star", label: "Star" },
  { value: "clock", label: "Clock" },
  { value: "card", label: "Card (payment)" },
  { value: "phone", label: "Phone" },
  { value: "heart", label: "Heart" },
  { value: "sparkles", label: "Sparkles (new)" },
];

export function WebsitePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const saved = useQuery({ queryKey: ["storefront"], queryFn: () => api.get<StorefrontContentRead>("/storefront") });
  // The draft being edited; null until the saved content has loaded.
  const [draft, setDraft] = useState<StorefrontContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start from the saved content (and again after each save).
  useEffect(() => {
    if (saved.data) setDraft(structuredClone(saved.data.content));
  }, [saved.data]);

  const dirty = !!draft && !!saved.data && JSON.stringify(draft) !== JSON.stringify(saved.data.content);

  // Leaving with unsaved changes asks first (browser's own prompt).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (content: StorefrontContent) => api.put<StorefrontContentRead>("/storefront", content),
    onSuccess: (r) => {
      qc.setQueryData(["storefront"], r);
      setError(null);
      toast.success("Saved — the website shows it within a minute");
    },
    // e.g. a link that isn't a page or a web address.
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (saved.isPending || !draft) return <PageLoading />;
  if (saved.isError) return <ErrorState error={saved.error} />;

  /** Replaces one top-level section of the draft. */
  const set = <K extends keyof StorefrontContent>(key: K, value: StorefrontContent[K]) => setDraft({ ...draft, [key]: value });
  const readOnly = !can.manageCatalog;

  return (
    <>
      <PageHeader
        title="Website"
        description="What shoppers see on the online shop. Changes appear on the site within a minute of saving."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a href={STOREFRONT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-2 text-sm font-semibold text-brand-700 hover:underline">
              View the site <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {dirty && (
              <Button variant="secondary" onClick={() => setDraft(structuredClone(saved.data.content))}>
                Discard changes
              </Button>
            )}
            {!readOnly && (
              <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>
                Save changes
              </Button>
            )}
          </div>
        }
      />

      <div className="max-w-4xl space-y-6">
        <FormError message={error} />
        {/* fieldset disabled: view-only for staff who can't edit. */}
        <fieldset disabled={readOnly} className="space-y-6">
          <AnnouncementCard value={draft.announcement} onChange={(v) => set("announcement", v)} />
          <BannerCard value={draft.hero} onChange={(v) => set("hero", v)} />
          <HighlightsCard value={draft.highlights} onChange={(v) => set("highlights", v)} />
          <SectionsCard draft={draft} set={set} />
          <WholesaleCard value={draft.wholesale} onChange={(v) => set("wholesale", v)} />
          <FooterCard draft={draft} set={set} />
        </fieldset>
        <p className="text-xs text-muted">
          Last saved {dateTime(saved.data.updated_at)}
          {saved.data.updated_by_name ? ` by ${saved.data.updated_by_name}` : ""}. Every change is recorded in the activity log.
        </p>
      </div>
    </>
  );
}

// --- sections ----------------------------------------------------------------

function AnnouncementCard({ value, onChange }: { value: StorefrontContent["announcement"]; onChange: (v: StorefrontContent["announcement"]) => void }) {
  return (
    <Card>
      <CardHeader
        title="Announcement strip"
        description="The thin bar above the header, on every page."
        actions={<Toggle checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} label="Show the announcement strip" />}
      />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Message">
          <Input maxLength={120} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />
        </Field>
        <Field label="More (wider screens only)" hint="Shown after the message on tablets and computers.">
          <Input maxLength={120} value={value.extra} onChange={(e) => onChange({ ...value, extra: e.target.value })} />
        </Field>
      </div>
    </Card>
  );
}

/** The home page's opening banner: words, two buttons and up to three
 * photos. Photos are uploaded through the same endpoint as product photos. */
function BannerCard({ value, onChange }: { value: StorefrontContent["hero"]; onChange: (v: StorefrontContent["hero"]) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const patch = (p: Partial<StorefrontContent["hero"]>) => onChange({ ...value, ...p });

  // Shrunk and uploaded together (lib/photos.ts), up to the three allowed.
  const upload = async (files: FileList) => {
    setUploading(true);
    const room = 3 - value.image_paths.length;
    const paths: string[] = [];
    const failures = await uploadPhotos(imageFiles(files).slice(0, room), (path, index) => {
      paths[index] = path;
    });
    patch({ image_paths: [...value.image_paths, ...paths.filter(Boolean)] });
    if (failures.length) toast.error(failures.map((f) => `${f.name}: ${f.reason}`).join(" · "));
    setUploading(false);
  };

  return (
    <Card>
      <CardHeader title="Home page banner" description="The first thing shoppers see." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Small heading" className="sm:col-span-2">
          <Input maxLength={60} value={value.eyebrow} onChange={(e) => patch({ eyebrow: e.target.value })} />
        </Field>
        <Field label="Headline" className="sm:col-span-2">
          <Input maxLength={90} value={value.title} onChange={(e) => patch({ title: e.target.value })} />
        </Field>
        <Field label="Text" className="sm:col-span-2">
          <Textarea maxLength={300} value={value.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} />
        </Field>
        <Field label="Main button">
          <Input maxLength={40} value={value.primary_label} onChange={(e) => patch({ primary_label: e.target.value })} />
        </Field>
        <Field label="…goes to" hint={LINK_HINT}>
          <Input value={value.primary_link} onChange={(e) => patch({ primary_link: e.target.value })} />
        </Field>
        <Field label="Second button" hint="Leave empty to hide it.">
          <Input maxLength={40} value={value.secondary_label} onChange={(e) => patch({ secondary_label: e.target.value })} />
        </Field>
        <Field label="…goes to" hint={LINK_HINT}>
          <Input value={value.secondary_link} onChange={(e) => patch({ secondary_link: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-xs font-semibold text-ink/80">Banner photos</p>
          <div className="flex flex-wrap items-start gap-3">
            {value.image_paths.map((path) => (
              <div key={path} className="relative">
                <img src={imageUrl(path)} alt="" className="h-28 w-24 rounded-xl object-cover ring-1 ring-line" />
                <IconButton
                  icon={X}
                  label="Remove photo"
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-white shadow"
                  onClick={() => patch({ image_paths: value.image_paths.filter((p) => p !== path) })}
                />
              </div>
            ))}
            {value.image_paths.length < 3 && (
              <Button variant="secondary" icon={ImagePlus} loading={uploading} onClick={() => fileRef.current?.click()}>
                Add photo
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="mt-1.5 text-xs text-muted">Up to three, shown on computers. With none, the three newest product photos are used.</p>
        </div>
      </div>
    </Card>
  );
}

const LINK_HINT = "A page of the shop, like /shop or /category/caps — or a full web address.";

function HighlightsCard({ value, onChange }: { value: StorefrontContent["highlights"]; onChange: (v: StorefrontContent["highlights"]) => void }) {
  const update = (i: number, p: Partial<StorefrontContent["highlights"][number]>) => onChange(value.map((h, j) => (j === i ? { ...h, ...p } : h)));
  return (
    <Card>
      <CardHeader title="Selling points" description="The row of short reasons to shop here, under the banner. Up to four." />
      <div className="space-y-3 p-5">
        {value.map((h, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[11rem_1fr_1.4fr_auto]">
            <Field label="Icon">
              <Select value={h.icon} onChange={(e) => update(i, { icon: e.target.value as HighlightIcon })}>
                {ICONS.map((ic) => (
                  <option key={ic.value} value={ic.value}>
                    {ic.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title">
              <Input maxLength={40} required value={h.title} onChange={(e) => update(i, { title: e.target.value })} />
            </Field>
            <Field label="Text">
              <Input maxLength={80} value={h.text} onChange={(e) => update(i, { text: e.target.value })} />
            </Field>
            <IconButton icon={Trash2} label="Remove" className="mb-1 hover:text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
        ))}
        {value.length < 4 && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...value, { icon: "star", title: "", text: "" }])}>
            Add a selling point
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Which home page sections show, and the hand-picked Featured row. */
function SectionsCard({ draft, set }: { draft: StorefrontContent; set: <K extends keyof StorefrontContent>(k: K, v: StorefrontContent[K]) => void }) {
  const featured = draft.featured;
  const patch = (p: Partial<StorefrontContent["featured"]>) => set("featured", { ...featured, ...p });
  return (
    <Card>
      <CardHeader title="Home page sections" />
      <div className="divide-y divide-line">
        <ToggleRow label="Shop by category" hint="Tiles for each category, with a photo." checked={draft.show_categories} onChange={(v) => set("show_categories", v)} />
        <ToggleRow label="New arrivals" hint="The eight newest products." checked={draft.show_new_arrivals} onChange={(v) => set("show_new_arrivals", v)} />
        <div className="p-5">
          <ToggleRow bare label="Featured products" hint="A hand-picked row, shown after the selling points." checked={featured.enabled} onChange={(enabled) => patch({ enabled })} />
          {featured.enabled && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Heading">
                  <Input maxLength={60} value={featured.title} onChange={(e) => patch({ title: e.target.value })} />
                </Field>
                <Field label="Text (optional)">
                  <Input maxLength={160} value={featured.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} />
                </Field>
              </div>
              <FeaturedPicker ids={featured.product_ids} onChange={(product_ids) => patch({ product_ids })} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ToggleRow({ label, hint, checked, onChange, bare }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; bare?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${bare ? "" : "px-5 py-4"}`}>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Choosing and ordering the featured products (up to 12). Only live
 * products are offered; one that's later unpublished simply drops off the
 * website until it's live again. */
function FeaturedPicker({ ids, onChange }: { ids: string[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  // The chosen products' details (name, photo), fetched by id.
  const chosen = useQuery({
    queryKey: ["products", "featured", ids],
    queryFn: () => Promise.all(ids.map((id) => api.get<Product>(`/products/${id}`).catch(() => null))),
  });
  const results = useQuery({
    queryKey: ["products", "featured-search", debounced],
    queryFn: () => api.list<Product>("/products", { status: "active", search: debounced, limit: 8 }),
    enabled: debounced.length > 0,
  });
  const byId = new Map((chosen.data ?? []).filter(Boolean).map((p) => [p!.id, p!]));
  const move = (i: number, by: number) => {
    const next = [...ids];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-ink/80">Products, in the order shown ({ids.length}/12)</p>
      {ids.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {ids.map((id, i) => {
            const p = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Thumb path={p ? primaryImage(p)?.storage_path : null} size={36} />
                <span className="min-w-0 flex-1 truncate font-medium">{p ? p.name : chosen.isPending ? "…" : "No longer available"}</span>
                {p && p.status !== "active" && <span className="text-xs font-semibold text-amber-700">Not live — hidden</span>}
                <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30" />
                <IconButton icon={ArrowDown} label="Move down" disabled={i === ids.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30" />
                <IconButton icon={Trash2} label="Remove" onClick={() => onChange(ids.filter((x) => x !== id))} className="hover:text-red-600" />
              </li>
            );
          })}
        </ul>
      )}
      {ids.length < 12 && (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input className="pl-9" placeholder="Search live products to add…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {debounced && (
            <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {results.data?.rows
                .filter((p) => !ids.includes(p.id))
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange([...ids, p.id]);
                        setSearch("");
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-canvas"
                    >
                      <Thumb path={primaryImage(p)?.storage_path} size={32} />
                      <span className="flex-1 font-medium">{p.name}</span>
                      <Plus className="h-4 w-4 text-brand-600" />
                    </button>
                  </li>
                ))}
              {results.data?.rows.length === 0 && <li className="p-3 text-sm text-muted">No live products match.</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function WholesaleCard({ value, onChange }: { value: StorefrontContent["wholesale"]; onChange: (v: StorefrontContent["wholesale"]) => void }) {
  const patch = (p: Partial<StorefrontContent["wholesale"]>) => onChange({ ...value, ...p });
  const updatePoint = (i: number, p: Partial<{ title: string; text: string }>) => patch({ points: value.points.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <Card>
      <CardHeader
        title="Wholesale section"
        description="The pitch to businesses at the bottom of the home page."
        actions={<Toggle checked={value.enabled} onChange={(enabled) => patch({ enabled })} label="Show the wholesale section" />}
      />
      {value.enabled && (
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Small heading">
            <Input maxLength={60} value={value.eyebrow} onChange={(e) => patch({ eyebrow: e.target.value })} />
          </Field>
          <Field label="Headline">
            <Input maxLength={90} value={value.title} onChange={(e) => patch({ title: e.target.value })} />
          </Field>
          <Field label="Text" className="sm:col-span-2">
            <Textarea maxLength={400} value={value.text} onChange={(e) => patch({ text: e.target.value })} />
          </Field>
          <Field label="Button" hint="Leave empty to hide it.">
            <Input maxLength={40} value={value.button_label} onChange={(e) => patch({ button_label: e.target.value })} />
          </Field>
          <Field label="…goes to" hint={LINK_HINT}>
            <Input value={value.button_link} onChange={(e) => patch({ button_link: e.target.value })} />
          </Field>
          <div className="space-y-3 sm:col-span-2">
            <p className="text-xs font-semibold text-ink/80">Points (up to four)</p>
            {value.points.map((pt, i) => (
              <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1.6fr_auto]">
                <Input maxLength={40} placeholder="Title" value={pt.title} onChange={(e) => updatePoint(i, { title: e.target.value })} />
                <Input maxLength={80} placeholder="Text" value={pt.text} onChange={(e) => updatePoint(i, { text: e.target.value })} />
                <IconButton icon={Trash2} label="Remove point" className="hover:text-red-600" onClick={() => patch({ points: value.points.filter((_, j) => j !== i) })} />
              </div>
            ))}
            {value.points.length < 4 && (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => patch({ points: [...value.points, { title: "", text: "" }] })}>
                Add a point
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function FooterCard({ draft, set }: { draft: StorefrontContent; set: <K extends keyof StorefrontContent>(k: K, v: StorefrontContent[K]) => void }) {
  const contact = (p: Partial<StorefrontContent["contact"]>) => set("contact", { ...draft.contact, ...p });
  const social = (p: Partial<StorefrontContent["social"]>) => set("social", { ...draft.social, ...p });
  return (
    <Card>
      <CardHeader title="Footer, contact and social" description="Shown at the bottom of every page; contact details also on the wholesale page. Empty fields are left out." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="About the shop" className="sm:col-span-2">
          <Textarea maxLength={300} value={draft.footer_blurb} onChange={(e) => set("footer_blurb", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={draft.contact.phone} onChange={(e) => contact({ phone: e.target.value })} placeholder="024 123 4567" />
        </Field>
        <Field label="WhatsApp number">
          <Input type="tel" value={draft.contact.whatsapp} onChange={(e) => contact({ whatsapp: e.target.value })} placeholder="024 123 4567" />
        </Field>
        <Field label="Email">
          <Input type="email" value={draft.contact.email} onChange={(e) => contact({ email: e.target.value })} />
        </Field>
        <Field label="Address">
          <Input value={draft.contact.address} onChange={(e) => contact({ address: e.target.value })} placeholder="Street, area, town" />
        </Field>
        <Field label="Instagram" hint="Full address, e.g. https://instagram.com/…">
          <Input value={draft.social.instagram} onChange={(e) => social({ instagram: e.target.value })} />
        </Field>
        <Field label="Facebook">
          <Input value={draft.social.facebook} onChange={(e) => social({ facebook: e.target.value })} />
        </Field>
        <Field label="TikTok">
          <Input value={draft.social.tiktok} onChange={(e) => social({ tiktok: e.target.value })} />
        </Field>
        <Field label="X (Twitter)">
          <Input value={draft.social.x} onChange={(e) => social({ x: e.target.value })} />
        </Field>
      </div>
    </Card>
  );
}
