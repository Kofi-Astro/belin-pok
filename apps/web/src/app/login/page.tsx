// /login -- customer sign-in, by email and password. On success the API
// returns tokens that lib/session.ts keeps in the browser, and the
// customer is sent on to ?next= (e.g. back to checkout) or their account.
// Staff sign in to the separate admin app, not here.
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthCard, FormError } from "@/components/AuthCard";
import { ApiError, session } from "@/lib/session";

/** Only same-site paths are followed after signing in, so a crafted
 * ?next= link can't bounce someone off to another website. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

// The form itself; see LoginPage for why it's split out.
function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.signIn(email.trim(), password);
      router.push(next);
    } catch (err) {
      // E.g. "wrong email or password", or a slow-down after repeated failed
      // attempts -- straight from the API. busy is only reset on failure;
      // on success the page navigates away.
      setError(err instanceof ApiError ? err.message : "Couldn't reach the shop — check your connection.");
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle={
        <>
          New here?{" "}
          {/* Pass ?next on, so registering returns them to the same place. */}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <FormError message={error} />
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" required autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="password">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs font-semibold text-brand-700 hover:underline">
              Forgot it?
            </Link>
          </div>
          <input id="password" type="password" required autoComplete="current-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="btn-dark w-full py-3.5">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary to render on the server.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
