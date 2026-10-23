"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { ApiError, session } from "@/lib/session";

function RegisterForm() {
  const router = useRouter();
  const nextParam = useSearchParams().get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account";
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // One call creates the login and the customer profile together.
      await session.signUp({ ...form, email: form.email.trim(), full_name: form.full_name.trim() });
      router.push(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the shop — check your connection.");
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Create your account"
      subtitle={
        <>
          Track orders and check out faster. Already have one?{" "}
          <Link href="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <FormError message={error} />
        <div>
          <label className="label" htmlFor="name">
            Full name
          </label>
          <input id="name" required autoComplete="name" className="field" value={form.full_name} onChange={set("full_name")} />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" required autoComplete="email" className="field" value={form.email} onChange={set("email")} />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone <span className="font-semibold text-muted normal-case">(optional)</span>
          </label>
          <input id="phone" type="tel" autoComplete="tel" className="field" value={form.phone} onChange={set("phone")} />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          {/* Same 8-character minimum the API enforces. */}
          <input id="password" type="password" required minLength={8} autoComplete="new-password" className="field" value={form.password} onChange={set("password")} />
          <p className="mt-1.5 text-xs text-muted">At least 8 characters.</p>
        </div>
        <button type="submit" disabled={busy} className="btn-dark w-full py-3.5">
          {busy ? "Creating your account…" : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
