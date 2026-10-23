// The signed-in customer's session, in the browser. Mirrors AuthSession in
// packages/belpok_core (the Flutter apps' version) -- see
// services/api/app/routers/auth.py for the server side of every call.
//
// - The short-lived access token lives only in memory.
// - The refresh token is kept in localStorage so a reload stays signed in.
//   Refresh tokens are single-use (the server issues a new one on every
//   refresh), so concurrent refreshes share one in-flight request --
//   otherwise all but the first would fail and sign the customer out.
import { API_BASE_URL } from "./format";
import type { TokenPair } from "./types";

const STORAGE_KEY = "belpok.web.session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** FastAPI puts the reason in `detail` -- a string, or for validation
 * errors a list whose first entry's `msg` is the useful part. */
async function errorFrom(res: Response): Promise<ApiError> {
  let message = `Something went wrong (${res.status})`;
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail) && detail[0]?.msg) message = String(detail[0].msg).replace(/^Value error, /, "");
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return new ApiError(res.status, message);
}

type Listener = () => void;

class Session {
  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private refreshToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.refreshToken = window.localStorage.getItem(STORAGE_KEY);
      } catch {
        // Storage blocked (private mode etc.): just start signed out.
      }
    }
  }

  get isSignedIn(): boolean {
    return this.refreshToken !== null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private store(tokens: TokenPair) {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    // Refresh 30s early rather than wait for a 401.
    this.accessExpiresAt = Date.now() + (tokens.expires_in - 30) * 1000;
    try {
      window.localStorage.setItem(STORAGE_KEY, tokens.refresh_token);
    } catch {}
    this.notify();
  }

  private clear() {
    const wasSignedIn = this.isSignedIn;
    this.accessToken = null;
    this.refreshToken = null;
    this.accessExpiresAt = 0;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
    if (wasSignedIn) this.notify();
  }

  private async post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await errorFrom(res);
    return (res.status === 204 ? null : await res.json()) as T;
  }

  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      this.store(await this.post<TokenPair>("/auth/refresh", { refresh_token: this.refreshToken }));
      return true;
    } catch (e) {
      // Refused (expired, signed out elsewhere): sign out here too. A
      // network failure keeps the session -- being offline briefly
      // shouldn't cost anyone their sign-in.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) this.clear();
      return false;
    }
  }

  async token(): Promise<string | null> {
    if (!this.refreshToken) return null;
    if (!this.accessToken || Date.now() >= this.accessExpiresAt) await this.refresh();
    return this.accessToken;
  }

  async signIn(email: string, password: string) {
    this.store(await this.post<TokenPair>("/auth/login", { identifier: email, password }));
  }

  async signUp(input: { email: string; password: string; full_name: string; phone?: string }) {
    this.store(await this.post<TokenPair>("/auth/signup", { ...input, phone: input.phone || undefined }));
  }

  async requestPasswordReset(email: string) {
    await this.post("/auth/forgot-password", { email });
  }

  async resetPassword(token: string, newPassword: string) {
    this.store(await this.post<TokenPair>("/auth/set-password", { token, new_password: newPassword }));
  }

  async signOut() {
    const refreshToken = this.refreshToken;
    this.clear();
    if (refreshToken) {
      try {
        await this.post("/auth/logout", { refresh_token: refreshToken });
      } catch {}
    }
  }

  /** An API call carrying the session's token (when signed in), with one
   * refresh-and-retry if the token turns out to be stale. */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const send = async () => {
      const token = await this.token();
      return fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
    };
    let res = await send();
    if (res.status === 401 && this.isSignedIn && (await this.refresh())) res = await send();
    if (!res.ok) throw await errorFrom(res);
    return (res.status === 204 ? null : await res.json()) as T;
  }
}

export const session = new Session();
