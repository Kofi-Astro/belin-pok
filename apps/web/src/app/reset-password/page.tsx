"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { ApiError, session } from "@/lib/session";

/** Where a password-reset email lands (/reset-password?token=... -- see
 * create_one_time_link in services/api/app/routers/auth.py). Saving also
 * signs the customer in. */
function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <AuthCard title="This link isn't complete" subtitle="Request a new reset link and use the newest email.">
        <Link href="/forgot-password" className="btn-dark w-full">
          Get a new link
        </Link>
      </AuthCard>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await session.resetPassword(token, password);
      router.push("/account");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the shop — check your connection.");
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="space-y-5">
        <FormError message={error} />
        <div>
          <label className="label" htmlFor="password">
            New password
          </label>
          <input id="password" type="password" required minLength={8} autoComplete="new-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Confirm it
          </label>
          <input id="confirm" type="password" required minLength={8} autoComplete="new-password" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="btn-dark w-full py-3.5">
          {busy ? "Saving…" : "Save and sign in"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
