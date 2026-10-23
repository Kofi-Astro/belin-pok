"use client";

// Who's signed in, for any component that needs to know. Signed out is a
// normal state on the storefront: browsing and guest checkout don't need
// an account.
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { ApiError, session } from "./session";
import type { Customer } from "./types";

type AuthState = {
  // "loading" until a saved session has been checked, so the header doesn't
  // flash "Sign in" at someone who's signed in.
  status: "loading" | "signedOut" | "signedIn";
  customer: Customer | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [customer, setCustomer] = useState<Customer | null>(null);

  const reload = useCallback(async () => {
    if (!session.isSignedIn) {
      setCustomer(null);
      setStatus("signedOut");
      return;
    }
    try {
      setCustomer(await session.request<Customer>("/customers/me"));
      setStatus("signedIn");
    } catch (e) {
      // 403: a staff login has no customer profile -- don't keep it here.
      if (e instanceof ApiError && e.status === 403) await session.signOut();
      setCustomer(null);
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    void reload();
    return session.subscribe(() => void reload());
  }, [reload]);

  const signOut = useCallback(() => session.signOut(), []);

  return <AuthContext.Provider value={{ status, customer, reload, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
