// The admin's small design system: every screen is built from these, so
// spacing, colours and states stay consistent across the app.
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import { forwardRef } from "react";

// ---------- buttons ----------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-sm",
  secondary: "bg-white text-ink border border-line hover:bg-canvas shadow-sm",
  ghost: "text-ink/80 hover:bg-black/5",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: "sm" | "md";
    icon?: LucideIcon;
    loading?: boolean;
  }
>(function Button({ variant = "primary", size = "md", icon: Icon, loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        buttonStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function IconButton({
  icon: Icon,
  label,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx("inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-black/5 hover:text-ink", className)}
      {...rest}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ---------- form fields ----------

// Full width unless the caller sets a width (w-40, w-48, ...) -- two
// conflicting width utilities would otherwise be decided by stylesheet
// order, not by which one the caller meant.
const fullWidthUnlessSized = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? undefined : "w-full");

const fieldBase =
  "rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 shadow-xs focus:border-brand-500 focus:ring-3 focus:ring-brand-100 focus:outline-none disabled:bg-canvas";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx(fieldBase, fullWidthUnlessSized(className), "h-10", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(fieldBase, fullWidthUnlessSized(className), "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(fieldBase, fullWidthUnlessSized(className), "min-h-24 py-2", className)} {...rest} />;
}

/** Label + control + optional hint, the standard form row. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold text-ink/80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{message}</p>;
}

// ---------- display ----------

export type Tone = "neutral" | "brand" | "green" | "amber" | "red" | "blue";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700 ring-gray-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset", toneStyles[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={clsx("rounded-xl border border-line bg-white shadow-xs", className)}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Title row at the top of every page. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-xs font-medium text-muted">{breadcrumb}</div>}
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-5 w-5 animate-spin text-brand-600", className)} />;
}

export function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner />
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: LucideIcon;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-4 font-semibold">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
      {error instanceof Error ? error.message : "Something went wrong loading this."}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "brand",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: LucideIcon;
  tone?: "brand" | "green" | "amber" | "red";
}) {
  const iconTone = {
    brand: "bg-brand-50 text-brand-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
  }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
        <span className={clsx("flex h-8 w-8 items-center justify-center rounded-lg", iconTone)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="tabular mt-3 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap",
            value === t.value ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={clsx("rounded-full px-1.5 text-xs", value === t.value ? "bg-brand-50" : "bg-black/5")}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------- tables ----------

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={clsx("border-b border-line bg-canvas/60 px-4 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={clsx("border-b border-line px-4 py-3 align-middle", className)}>{children}</td>;
}

/** "1–25 of 140" with previous/next. Page is 0-based. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)} className="disabled:opacity-30" />
        <IconButton icon={ChevronRight} label="Next page" disabled={to >= total} onClick={() => onPage(page + 1)} className="disabled:opacity-30" />
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-brand-600" : "bg-gray-300",
      )}
    >
      <span className={clsx("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700", className)}>
      {initials || "?"}
    </span>
  );
}
