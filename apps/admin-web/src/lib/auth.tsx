// Who's signed in, and what their role lets them do. The API enforces
// every one of these rules itself (require_role in app/deps.py); the flags
// here only decide what the UI offers, so nobody is shown a button that
// would just come back "not permitted".
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api } from "./api";
import { ApiError, session } from "./session";
import type { Staff, StaffRole } from "./types";

type Status = "loading" | "signedOut" | "signedIn";

export type Permissions = {
  isOwner: boolean;
  /** Products, categories, prices, receiving stock, dashboard (owner, inventory manager). */
  manageCatalog: boolean;
  /** Stock movements and POS sales (adds order fulfilment). */
  adjustStock: boolean;
  /** Order status, customers and credit (owner, order fulfilment). */
  manageOrders: boolean;
};

type AuthState = {
  status: Status;
  staff: Staff | null;
  mustChangePassword: boolean;
  can: Permissions;
  /** Set when a signed-in login turned out not to be an active staff member. */
  notice: string | null;
  signOut: () => Promise<void>;
};

const none: Permissions = { isOwner: false, manageCatalog: false, adjustStock: false, manageOrders: false };

function permissionsFor(staff: Staff | null): Permissions {
  if (!staff) return none;
  // A person can hold several roles; they get everything any of them allows.
  const has = (r: StaffRole) => staff.roles.includes(r);
  return {
    isOwner: has("owner"),
    manageCatalog: has("owner") || has("inventory_manager"),
    adjustStock: has("owner") || has("inventory_manager") || has("order_fulfillment"),
    manageOrders: has("owner") || has("order_fulfillment"),
  };
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [staff, setStaff] = useState<Staff | null>(null);
  const [mustChange, setMustChange] = useState(session.mustChangePassword);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMustChange(session.mustChangePassword);
    if (!session.isSignedIn) {
      setStaff(null);
      setStatus("signedOut");
      return;
    }
    try {
      setStaff(await api.get<Staff>("/staff/me"));
      setNotice(null);
      setStatus("signedIn");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // A customer's login, or a deactivated staff member: don't keep it.
        setNotice("This account doesn't have access to the admin. Ask an owner to invite you.");
        await session.signOut();
      }
      setStaff(null);
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    void load();
    return session.subscribe(() => void load());
  }, [load]);

  return (
    <AuthContext.Provider
      value={{
        status,
        staff,
        mustChangePassword: mustChange,
        can: permissionsFor(staff),
        notice,
        signOut: () => session.signOut(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
