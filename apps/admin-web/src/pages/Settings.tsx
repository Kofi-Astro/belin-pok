// Three settings pages that share this file:
//   - Categories: how products are grouped -- the website's menu and
//     category pages, the till's category chips and quick-log types;
//   - Staff: who can sign in to the admin and what each person may do
//     (owner only), including invite and sign-in links;
//   - Account: the signed-in person's own details and password.
// (The shop-wide online pricing lives on its own page, ShopSettings.tsx.)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Mail, MessageCircle, Pencil, Plus, Share2, Smartphone, Tags, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog, Modal, useToast } from "@/components/overlay";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, FormError, IconButton, Input, PageHeader, PageLoading, Table, Td, Textarea, Th, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, slugify, titleCase } from "@/lib/format";
import { useCategories } from "@/lib/queries";
import { session } from "@/lib/session";
import type { Category, Staff, StaffRole } from "@/lib/types";

// ---------- categories ----------

// The category list, with how many products each holds and its menu
// position. Editing needs the manageCatalog permission.
export function CategoriesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useCategories();
  // How many products each category holds (any status -- drafts and
  // archived count too, since they also stop a category being deleted).
  // One small request per category, reading just the total.
  const counts = useQuery({
    queryKey: ["category-counts", categories.data?.length],
    enabled: !!categories.data,
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          categories.data!.map(async (c) => [c.id, (await api.list("/products", { category_id: c.id, limit: 1 })).total] as const),
        ),
      ),
  });
  // The category in the edit dialog ("new" = creating), and the one
  // waiting for delete confirmation.
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const remove = useMutation({
    mutationFn: (c: Category) => api.del(`/categories/${c.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category deleted");
      setDeleting(null);
    },
    onError: (e) => {
      setDeleting(null);
      toast.error(e);
    },
  });

  if (categories.isPending) return <PageLoading />;
  if (categories.isError) return <ErrorState error={categories.error} />;

  return (
    <>
      <PageHeader
        title="Categories"
        description="How products are grouped on the shop's menu and in the till's quick-log."
        actions={
          can.manageCatalog && (
            <Button icon={Plus} onClick={() => setEditing("new")}>
              New category
            </Button>
          )
        }
      />
      <Card>
        {categories.data.length === 0 ? (
          <EmptyState icon={Tags} title="No categories yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Web address</Th>
                <Th className="text-right">Products</Th>
                <Th className="text-right">Order</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {categories.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <p className="font-semibold">{c.name}</p>
                    {c.description && <p className="text-xs text-muted">{c.description}</p>}
                  </Td>
                  {/* Its page on the website. Fixed when created, so links don't break
                     if it's renamed later. */}
                  <Td className="font-mono text-xs text-muted">/category/{c.slug}</Td>
                  <Td className="tabular text-right">{counts.data?.[c.id] ?? "…"}</Td>
                  <Td className="tabular text-right text-muted">{c.display_order}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {can.manageCatalog && (
                      <>
                        <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(c)} />
                        <IconButton icon={Trash2} label="Delete" onClick={() => setDeleting(c)} className="hover:text-red-600" />
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <CategoryModal category={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        busy={remove.isPending}
        danger
        title={`Delete "${deleting?.name}"?`}
        confirmLabel="Delete"
        message="Only possible while no products are in it — move them to another category first."
      />
    </>
  );
}

// Create or edit a category: name, optional description (shown at the top
// of its page on the website) and menu position.
function CategoryModal({ category, onClose }: { category: Category | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = category === "new";
  const [form, setForm] = useState({ name: "", description: "", display_order: "0" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!category) return;
    setError(null);
    setForm(
      category === "new"
        ? { name: "", description: "", display_order: "0" }
        : { name: category.name, description: category.description ?? "", display_order: String(category.display_order) },
    );
  }, [category]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { name: form.name.trim(), description: form.description.trim() || null, display_order: Number(form.display_order || 0) };
    try {
      // The web address (slug) is made from the name once, on creation.
      if (isNew) await api.post("/categories", { ...body, slug: slugify(form.name) });
      else await api.patch(`/categories/${(category as Category).id}`, body);
      await qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success(isNew ? "Category created" : "Category saved");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!category}
      onClose={onClose}
      title={isNew ? "New category" : "Edit category"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={save} className="space-y-4">
        <FormError message={error} />
        <Field label="Name">
          <Input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description (optional)" hint="Shown at the top of the category page on the shop.">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Menu order" hint="Lower numbers come first.">
          <Input type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

// ---------- staff ----------

// The roles, in plain words. The API decides what each can actually do
// (require_role in app/deps.py); lib/auth.tsx mirrors it so the admin
// only offers what will work.
const ROLES: { value: StaffRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including staff and the change history" },
  { value: "inventory_manager", label: "Inventory manager", description: "Products, prices, stock, the till and reports" },
  { value: "order_fulfillment", label: "Sales & orders", description: "The till, online orders, customers and credit" },
  { value: "viewer", label: "Viewer", description: "Can look, can't change anything" },
];
// "inventory_manager" -> "Inventory manager"; several -> "A + B".
const roleLabel = (r: StaffRole) => ROLES.find((x) => x.value === r)?.label ?? titleCase(r);
const rolesLabel = (roles: StaffRole[]) => roles.map(roleLabel).join(" + ");

/** Tick one or more roles. Inventory manager and Sales & orders combine
 * (someone who runs stock and also serves customers gets both); Owner
 * already includes everything and Viewer is read-only, so ticking either
 * clears the rest -- the same rules the API enforces. */
function RolePicker({ value, onChange, disabled }: { value: StaffRole[]; onChange: (roles: StaffRole[]) => void; disabled?: boolean }) {
  // Untick: just remove it. Tick Owner or Viewer: that role alone. Tick
  // any other: add it, dropping Owner/Viewer if either was ticked.
  const toggle = (r: StaffRole) => {
    if (value.includes(r)) return onChange(value.filter((x) => x !== r));
    if (r === "owner" || r === "viewer") return onChange([r]);
    onChange([...value.filter((x) => x !== "owner" && x !== "viewer"), r]);
  };
  return (
    <div className="grid gap-2">
      {ROLES.map((r) => {
        const on = value.includes(r.value);
        return (
          <label
            key={r.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${on ? "border-brand-500 bg-brand-50" : "border-line hover:border-ink/20"} ${disabled ? "pointer-events-none opacity-60" : ""}`}
          >
            <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(r.value)} className="mt-0.5 h-4 w-4 accent-brand-600" />
            <span>
              <span className="block text-sm font-semibold">{r.label}</span>
              <span className="text-xs text-muted">{r.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

// Staff accounts (owner only -- the API refuses everyone else). An owner
// can change anyone's roles or switch them off, except their own: so the
// shop can never be left without an owner by accident.
export function StaffPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { staff: me } = useAuth();
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api.get<Staff[]>("/staff") });
  const [inviting, setInviting] = useState(false);
  // A freshly issued invite/sign-in link, shown in LinkModal to send on.
  const [link, setLink] = useState<IssuedLink | null>(null);
  // The person whose roles are being changed, and the roles ticked.
  const [editing, setEditing] = useState<Staff | null>(null);
  const [editRoles, setEditRoles] = useState<StaffRole[]>([]);

  // Saves a role change or switches an account on/off. Both are recorded
  // in the activity log. A switched-off account can't sign in, but its
  // history (sales, changes) is kept.
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; roles?: StaffRole[]; is_active?: boolean }) => api.patch(`/staff/${id}`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e),
  });

  // Issues a new one-time link for someone to set their password -- for a
  // forgotten password, or an invite that expired. (Older unused links
  // aren't cancelled; each still works once until it expires.)
  const newLink = async (s: Staff) => {
    try {
      const r = await api.post<InviteResult>(`/staff/${s.id}/invite-link`);
      setLink({ staff: r, url: r.invite_link, emailSent: r.email_sent, isNew: false });
    } catch (e) {
      toast.error(e);
    }
  };

  if (staff.isPending) return <PageLoading />;
  if (staff.isError) return <ErrorState error={staff.error} />;

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can sign in to the admin, and what each person can do."
        actions={
          <Button icon={UserPlus} onClick={() => setInviting(true)}>
            Invite staff
          </Button>
        }
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Role</Th>
              <Th>Joined</Th>
              <Th>Active</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {staff.data.map((s) => {
              const isMe = s.id === me?.id;
              return (
                <tr key={s.id} className={s.is_active ? "" : "opacity-60"}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={s.full_name} />
                      <div>
                        <p className="font-semibold">
                          {s.full_name} {isMe && <Badge tone="brand">You</Badge>}
                        </p>
                        <p className="text-xs text-muted">{[s.email, s.phone].filter(Boolean).join(" · ") || "Signs in with a username"}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.roles.map((r) => (
                        <Badge key={r} tone={r === "owner" ? "brand" : "neutral"}>
                          {roleLabel(r)}
                        </Badge>
                      ))}
                      {!isMe && (
                        <IconButton
                          icon={Pencil}
                          label="Change roles"
                          onClick={() => {
                            setEditing(s);
                            setEditRoles(s.roles);
                          }}
                        />
                      )}
                    </div>
                  </Td>
                  <Td className="text-muted">{date(s.created_at)}</Td>
                  <Td>
                    {/* You can't switch yourself off. */}
                    <Toggle checked={s.is_active} disabled={isMe} label="Active" onChange={(on) => update.mutate({ id: s.id, is_active: on })} />
                  </Td>
                  <Td className="text-right">
                    {!isMe && (
                      <Button size="sm" variant="ghost" icon={Link2} onClick={() => void newLink(s)}>
                        Sign-in link
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {/* A key to what each role means, under the table. */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROLES.map((r) => (
          <Card key={r.value} className="p-4">
            <p className="text-sm font-semibold">{r.label}</p>
            <p className="mt-1 text-xs text-muted">{r.description}</p>
          </Card>
        ))}
      </div>
      <InviteModal open={inviting} onClose={() => setInviting(false)} onInvited={(r) => setLink({ staff: r, url: r.invite_link, emailSent: r.email_sent, isNew: true })} />
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Roles for ${editing?.full_name ?? ""}`}
        description="Tick everything they do. They get every permission of each role ticked."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!editRoles.length}
              loading={update.isPending}
              onClick={() => editing && update.mutate({ id: editing.id, roles: editRoles }, { onSuccess: () => setEditing(null) })}
            >
              Save roles
            </Button>
          </>
        }
      >
        <RolePicker value={editRoles} onChange={setEditRoles} />
      </Modal>
      <LinkModal link={link} onClose={() => setLink(null)} />
    </>
  );
}

/** What POST /staff/invite (and /invite-link) return: the staff record, the
 * one-time link, and whether the API managed to email it. */
type InviteResult = Staff & { invite_link: string; email_sent: boolean };

/** A link just issued, for LinkModal. isNew: a first invite (vs. a fresh
 * link for someone who already has an account), which changes the wording
 * of the message sent with it. */
type IssuedLink = { staff: Staff; url: string; emailSent: boolean; isNew: boolean };

// Invite a new staff member: creates their account with the roles ticked
// and returns a one-time link for them to choose a password. They can be
// invited with an email, a phone number or both -- whichever they have --
// and sign in with either. The link is then sent from LinkModal however
// suits: email, WhatsApp, SMS, or anything else on the owner's phone.
function InviteModal({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: (r: InviteResult) => void }) {
  const qc = useQueryClient();
  const blank = { full_name: "", email: "", phone: "", roles: ["order_fulfillment"] as StaffRole[] };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasContact = form.email.trim() !== "" || form.phone.trim() !== "";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Empty fields go up as null; the API checks at least one is given
      // and stores the phone number in one standard form.
      const r = await api.post<InviteResult>("/staff/invite", {
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        roles: form.roles,
      });
      await qc.invalidateQueries({ queryKey: ["staff"] });
      setForm(blank);
      onClose();
      onInvited(r);
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
      title="Invite a staff member"
      description="They'll get a link to choose a password — by email, WhatsApp, SMS or however you like."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={busy} disabled={!form.roles.length || !hasContact}>
            Create invite
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={save} className="space-y-4">
        <FormError message={error} />
        <Field label="Full name">
          <Input autoFocus required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" hint="If they have one.">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone" hint="For WhatsApp or SMS.">
            <Input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="024 123 4567" />
          </Field>
        </div>
        <p className="text-xs text-muted">Give at least one. They sign in with their email — or their phone number if they don&apos;t have one.</p>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink/80">What will they do? (tick all that apply)</p>
          <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
        </div>
      </form>
    </Modal>
  );
}

/** A Ghana number as WhatsApp wants it: country code, digits only
 * ("0241234567" -> "233241234567"). Mirrors international() in
 * services/api/app/phone.py; numbers are stored as 0XXXXXXXXX or +<digits>. */
function internationalPhone(phone: string): string {
  return phone.startsWith("+") ? phone.slice(1) : `233${phone.slice(1)}`;
}

// Passing on an invite/sign-in link. Every option sends from the owner's
// own accounts, so nothing needs setting up and nothing costs extra:
//   - Email: sent by the API when email sending is configured; otherwise
//     opens the owner's email app with the message written.
//   - WhatsApp: opens WhatsApp (app or web) to their number, message ready.
//   - SMS: opens the phone's messages app, message ready (on a phone or
//     tablet; a computer may have no SMS app).
//   - Share: the phone's own share menu -- Telegram, Messenger, anything.
//   - Copy: to paste anywhere.
// Anyone with the link can set that person's password, hence the warning.
function LinkModal({ link, onClose }: { link: IssuedLink | null; onClose: () => void }) {
  const toast = useToast();
  if (!link) return null;
  const { staff: person, url, emailSent, isNew } = link;
  const firstName = person.full_name.split(" ")[0];
  const signInWith = person.email ?? person.phone ?? "your username";
  const message = isNew
    ? `Hi ${firstName}, you've been added to the Belin-Pok shop admin. Set your password here (the link works once, for 7 days): ${url}\n\nAfter that, sign in with ${signInWith}.`
    : `Hi ${firstName}, here's a link to set a new password for the Belin-Pok shop admin (it works once, for 7 days): ${url}\n\nSign in with ${signInWith}.`;
  const text = encodeURIComponent(message);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  // Each channel: where it goes, and whether it's usable for this person.
  const channels = [
    !emailSent && person.email && { label: "Email", icon: Mail, href: `mailto:${person.email}?subject=${encodeURIComponent("Your Belin-Pok sign-in link")}&body=${text}` },
    { label: "WhatsApp", icon: MessageCircle, href: person.phone ? `https://wa.me/${internationalPhone(person.phone)}?text=${text}` : `https://wa.me/?text=${text}` },
    // "?&body=" works on both iPhone and Android messages apps.
    { label: "SMS", icon: Smartphone, href: `sms:${person.phone ?? ""}?&body=${text}` },
  ].filter(Boolean) as { label: string; icon: typeof Mail; href: string }[];

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? `Send ${firstName} their invite` : `New sign-in link for ${firstName}`}
      description={emailSent ? `Emailed to ${person.email}. You can send it another way too.` : "Choose how to send it."}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {channels.map((c) => (
            <a
              key={c.label}
              href={c.href}
              target={c.href.startsWith("https:") ? "_blank" : undefined}
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-semibold shadow-xs hover:bg-canvas"
            >
              <c.icon className="h-4 w-4 text-brand-600" /> {c.label}
            </a>
          ))}
          {canShare && (
            <Button variant="secondary" icon={Share2} onClick={() => void navigator.share({ title: "Belin-Pok sign-in link", text: message }).catch(() => {})}>
              Share…
            </Button>
          )}
          <Button
            variant="secondary"
            icon={Copy}
            onClick={async () => {
              await navigator.clipboard.writeText(message);
              toast.success("Message and link copied");
            }}
          >
            Copy
          </Button>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-ink/80">The message</p>
          <p className="rounded-lg bg-canvas p-3 text-xs break-words whitespace-pre-line">{message}</p>
        </div>
        <p className="text-xs text-muted">Only send it to {firstName} — whoever opens the link can set the password.</p>
      </div>
    </Modal>
  );
}

// ---------- my account ----------

// The signed-in person's own page: who they are, and changing their
// password -- which signs them out on every other device, so a lost
// phone or shared computer stops having access.
export function AccountPage() {
  const { staff } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // Checked here only; the API just receives the new password.
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await session.changePassword(password);
      setPassword("");
      setConfirm("");
      toast.success("Password changed — other devices have been signed out");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Your account" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <dl className="space-y-3 p-5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Name</dt>
              <dd className="font-medium">{staff?.full_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Sign-in</dt>
              <dd className="font-medium">{staff?.email ?? staff?.phone ?? "Username"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Role</dt>
              <dd className="font-medium">{staff && rolesLabel(staff.roles)}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Change password" description="Signs you out everywhere else." />
          <form onSubmit={save} className="space-y-4 p-5">
            <FormError message={error} />
            <Field label="New password" hint="At least 8 characters.">
              <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={busy}>
                Change password
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
