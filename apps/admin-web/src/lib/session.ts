// The signed-in staff member's session. Same scheme as the storefront's
// (apps/web/src/lib/session.ts) and the Flutter apps' AuthSession -- see
// services/api/app/routers/auth.py for the server side:
// - short-lived access token in memory only;
// - single-use refresh token in localStorage, so a reload stays signed in;
// - concurrent refreshes share one in-flight request (a second refresh with
//   the same token would be treated as a replay and end the session).
import type { TokenPair } from "./types";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

const STORAGE_KEY = "belpok.admin.session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `Something went wrong (${res.status})`;
  try {
    const detail = (await res.json())?.detail;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail) && detail[0]?.msg) message = String(detail[0].msg).replace(/^Value error, /, "");
  } catch {
    // Non-JSON body: keep the generic message.
  }
  return new ApiError(res.status, message);
}

type Stored = { refresh: string; mustChange: boolean };

class Session {
  private access: string | null = null;
  private accessExpiresAt = 0;
  private refreshToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();
  /** True for an account that must choose a new password before anything
   * else (the bootstrap owner) -- the app routes it to /set-password. */
  mustChangePassword = false;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Stored | null;
      if (saved) {
        this.refreshToken = saved.refresh;
        this.mustChangePassword = saved.mustChange;
      }
    } catch {
      // Storage unavailable or corrupt: start signed out.
    }
  }

  get isSignedIn() {
    return this.refreshToken !== null;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private store(t: TokenPair) {
    this.access = t.access_token;
    this.refreshToken = t.refresh_token;
    this.accessExpiresAt = Date.now() + (t.expires_in - 30) * 1000;
    this.mustChangePassword = t.must_change_password;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ refresh: t.refresh_token, mustChange: t.must_change_password }));
    } catch {}
    this.notify();
  }

  private clear() {
    const was = this.isSignedIn;
    this.access = null;
    this.refreshToken = null;
    this.accessExpiresAt = 0;
    this.mustChangePassword = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    if (was) this.notify();
  }

  private async post<T>(path: string, body: unknown, bearer?: string | null): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await errorFrom(res);
    return (res.status === 204 ? null : await res.json()) as T;
  }

  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async doRefresh() {
    if (!this.refreshToken) return false;
    try {
      this.store(await this.post<TokenPair>("/auth/refresh", { refresh_token: this.refreshToken }));
      return true;
    } catch (e) {
      // Refused: signed out elsewhere, expired, or deactivated. A network
      // blip keeps the session.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) this.clear();
      return false;
    }
  }

  private async token() {
    if (!this.refreshToken) return null;
    if (!this.access || Date.now() >= this.accessExpiresAt) await this.refresh();
    return this.access;
  }

  async signIn(identifier: string, password: string) {
    this.store(await this.post<TokenPair>("/auth/login", { identifier, password }));
  }

  async setPasswordWithToken(token: string, newPassword: string) {
    this.store(await this.post<TokenPair>("/auth/set-password", { token, new_password: newPassword }));
  }

  async changePassword(newPassword: string) {
    this.store(await this.post<TokenPair>("/auth/change-password", { new_password: newPassword }, await this.token()));
  }

  async requestPasswordReset(email: string) {
    await this.post("/auth/forgot-password", { email });
  }

  async signOut() {
    const rt = this.refreshToken;
    this.clear();
    if (rt) {
      try {
        await this.post("/auth/logout", { refresh_token: rt });
      } catch {}
    }
  }

  /** Any API call, with the session's token and one refresh-and-retry on a
   * 401. Returns the parsed body and the X-Total-Count header (for
   * paginated lists), when present. */
  async fetch<T>(path: string, init: RequestInit = {}): Promise<{ data: T; total: number | null }> {
    const send = async () => {
      const token = await this.token();
      const isForm = init.body instanceof FormData;
      return fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          // A FormData body sets its own multipart Content-Type (with boundary).
          ...(isForm ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
    };
    let res = await send();
    if (res.status === 401 && this.isSignedIn && (await this.refresh())) res = await send();
    if (!res.ok) throw await errorFrom(res);
    const total = res.headers.get("x-total-count");
    return { data: (res.status === 204 ? null : await res.json()) as T, total: total === null ? null : Number(total) };
  }
}

export const session = new Session();
