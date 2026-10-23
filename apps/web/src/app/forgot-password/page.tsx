"use client";

import Link from "next/link";
import { useState } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { ApiError, session } from "@/lib/session";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the shop — check your connection.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthCard title="Check your email">
        {/* Worded this way on purpose: the API never says whether an email
            has an account, so this page can't either. */}
        <p className="text-sm leading-relaxed text-muted">
          If <span className="font-semibold text-ink">{email}</span> has an account, we&apos;ve sent it a link to choose a new
          password. The link works once, for the next hour.
        </p>
        <Link href="/login" className="btn-outline mt-8 w-full">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we'll send you a link to choose a new one.">
      <form onSubmit={submit} className="space-y-5">
        <FormError message={error} />
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" required autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="btn-dark w-full py-3.5">
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  );
}
