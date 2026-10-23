// Categories, Staff and the signed-in user's own Account page.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Pencil, Plus, Tags, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog, Modal, useToast } from "@/components/overlay";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, FormError, IconButton, Input, PageHeader, PageLoading, Select, Table, Td, Textarea, Th, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, slugify, titleCase } from "@/lib/format";
import { useCategories } from "@/lib/queries";
import { session } from "@/lib/session";
import type { Category, Staff, StaffRole } from "@/lib/types";

// ---------- categories ----------

export function CategoriesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useCategories();
  // How many live products each category has, from the public catalogue.
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

const ROLES: { value: StaffRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including staff and the change history" },
  { value: "inventory_manager", label: "Inventory manager", description: "Products, prices, stock, the till and reports" },
  { value: "order_fulfillment", label: "Sales & orders", description: "The till, online orders, customers and credit" },
  { value: "viewer", label: "Viewer", description: "Can look, can't change anything" },
];
const roleLabel = (r: StaffRole) => ROLES.find((x) => x.value === r)?.label ?? titleCase(r);

export function StaffPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { staff: me } = useAuth();
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api.get<Staff[]>("/staff") });
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: StaffRole; is_active?: boolean }) => api.patch(`/staff/${id}`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e),
  });

  const newLink = async (s: Staff) => {
    try {
      const r = await api.post<Staff & { invite_link: string }>(`/staff/${s.id}/invite-link`);
      setLink({ name: s.full_name, url: r.invite_link });
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
                        <p className="text-xs text-muted">{s.email ?? "Signs in with a username"}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Select className="h-9 w-48" disabled={isMe} value={s.role} onChange={(e) => update.mutate({ id: s.id, role: e.target.value as StaffRole })}>
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td className="text-muted">{date(s.created_at)}</Td>
                  <Td>
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
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROLES.map((r) => (
          <Card key={r.value} className="p-4">
            <p className="text-sm font-semibold">{r.label}</p>
            <p className="mt-1 text-xs text-muted">{r.description}</p>
          </Card>
        ))}
      </div>
      <InviteModal open={inviting} onClose={() => setInviting(false)} onInvited={(name, url) => setLink({ name, url })} />
      <LinkModal link={link} onClose={() => setLink(null)} />
    </>
  );
}

function InviteModal({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: (name: string, url: string) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ full_name: "", email: "", role: "order_fulfillment" as StaffRole });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Staff & { invite_link: string }>("/staff/invite", { ...form, full_name: form.full_name.trim(), email: form.email.trim() });
      await qc.invalidateQueries({ queryKey: ["staff"] });
      setForm({ full_name: "", email: "", role: "order_fulfillment" });
      onClose();
      onInvited(r.full_name, r.invite_link);
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
      description="They'll get a link to choose a password."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={busy}>
            Send invite
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={save} className="space-y-4">
        <FormError message={error} />
        <Field label="Full name">
          <Input autoFocus required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="Email" hint="They'll sign in with this.">
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Role" hint={ROLES.find((r) => r.value === form.role)?.description}>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

function LinkModal({ link, onClose }: { link: { name: string; url: string } | null; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal
      open={!!link}
      onClose={onClose}
      title={`Sign-in link for ${link?.name ?? ""}`}
      description="It's been emailed if email is set up. You can also send it yourself, e.g. on WhatsApp."
      footer={
        <>
          <Button
            variant="secondary"
            icon={Copy}
            onClick={async () => {
              await navigator.clipboard.writeText(link!.url);
              toast.success("Link copied");
            }}
          >
            Copy link
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <p className="rounded-lg bg-canvas p-3 font-mono text-xs break-all">{link?.url}</p>
      <p className="mt-3 text-xs text-muted">Works once, for 7 days. Only send it to the person it&apos;s for — it lets them set the password.</p>
    </Modal>
  );
}

// ---------- my account ----------

export function AccountPage() {
  const { staff } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
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
              <dd className="font-medium">{staff?.email ?? "Username"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Role</dt>
              <dd className="font-medium">{staff && roleLabel(staff.role)}</dd>
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
