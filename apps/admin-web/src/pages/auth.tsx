// Signing in, forgotten passwords, and choosing a password (from an
// invite/reset link, or forced on first sign-in for the bootstrap owner).
import { BarChart3, Boxes, ScanBarcode } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

import { Button, Field, FormError, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ApiError, session } from "@/lib/session";

// An error as words: the API's own message (wrong password, too many
// attempts, expired link...), or a connection problem if there was no
// answer at all.
function message(err: unknown) {
  return err instanceof ApiError ? err.message : "Couldn't reach the server — check your connection.";
}

/** Brand panel on the left (wide screens), form on the right. */
function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-32 -bottom-32 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl" />
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="" className="h-10 w-10 rounded-lg" />
          <span className="text-lg font-bold">Belin-Pok</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl font-bold tracking-tight">Everything the shop runs on, in one place.</h2>
          <ul className="mt-8 space-y-4 text-white/75">
            {[
              [ScanBarcode, "Ring up sales at the counter, retail or wholesale"],
              [Boxes, "Receive deliveries and keep every SKU's stock exact"],
              [BarChart3, "See what's selling, what's low and who owes what"],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Boxes;
              return (
                <li key={text as string} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
                    <I className="h-4 w-4" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm">
          <img src="/icon.png" alt="" className="mb-8 h-10 w-10 rounded-lg lg:hidden" />
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Staff sign in with an email or a username (the first owner account has
// a username). notice: why a previous session was ended, e.g. a
// customer's login, or a deactivated account.
export function LoginPage() {
  const { status, notice } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. Back after signing in): go to the app.
  if (status === "signedIn") return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.signIn(identifier.trim(), password);
      // AuthProvider hears the new session and the router takes it from there.
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Sign in to manage the shop.">
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error ?? notice} />
        <Field label="Email, phone number or username">
          <Input autoFocus required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="font-medium text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

// Emails a one-time reset link (if email sending is set up -- otherwise
// an owner can issue a sign-in link from the Staff page).
export function ForgotPasswordPage() {
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
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        {/* Same wording whether or not the email has an account -- the API
            deliberately doesn't say. */}
        <p className="text-sm leading-relaxed text-muted">
          If <span className="font-semibold text-ink">{email}</span> belongs to an account, a reset link is on its way. It
          works once, for the next hour. No email? Ask an owner for a new sign-in link from the Staff page.
        </p>
        <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="Email">
          <Input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Send reset link
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

/** /set-password?token=... from an invite or reset link (works signed out),
 * or /set-password with no token: the forced change for an account flagged
 * must_change_password. */
export function SetPasswordPage() {
  const navigate = useNavigate();
  const token = useSearchParams()[0].get("token");
  const { status, mustChangePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Without a link token this page is only for a signed-in person who must
  // change their password; anyone else belongs at the sign-in page.
  if (!token && status === "signedOut") return <Navigate to="/login" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // With a token: set the password from the link (this also signs them in).
      // Without: change the signed-in person's own password.
      if (token) await session.setPasswordWithToken(token, password);
      else await session.changePassword(password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={token ? "Choose your password" : "Set a new password"}
      subtitle={
        token
          ? "You're almost in — pick a password to finish setting up your account."
          : mustChangePassword
            ? "Before you continue, replace the starting password with one only you know."
            : undefined
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="New password" hint="At least 8 characters.">
          <Input type="password" autoFocus required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Save and continue
        </Button>
      </form>
    </AuthLayout>
  );
}
