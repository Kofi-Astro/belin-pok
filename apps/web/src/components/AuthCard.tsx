import { LogoMark } from "./Logo";

/** The centred card every sign-in-related page uses. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="container-page flex justify-center py-16">
      <div className="w-full max-w-md rounded-3xl border border-line bg-white p-8 shadow-sm sm:p-10">
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-danger">{message}</p>;
}
