// Thin helpers over session.fetch for the screens: query strings from
// plain objects, JSON bodies, and lists that report their total count.
import { session } from "./session";

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

// Every request goes through session.fetch, which adds the access token,
// refreshes it when it expires (retrying once), and turns API errors into
// ApiError with the API's own message. Empty query values are dropped,
// so screens can pass filters without checking which are set.
export const api = {
  get: async <T>(path: string, query?: Query) => (await session.fetch<T>(withQuery(path, query))).data,
  /** A page of a list plus the total number of matches (X-Total-Count). */
  list: async <T>(path: string, query?: Query) => {
    const { data, total } = await session.fetch<T[]>(withQuery(path, query));
    return { rows: data, total: total ?? data.length };
  },
  post: async <T>(path: string, body: unknown = {}) =>
    (await session.fetch<T>(path, { method: "POST", body: JSON.stringify(body) })).data,
  patch: async <T>(path: string, body: unknown) =>
    (await session.fetch<T>(path, { method: "PATCH", body: JSON.stringify(body) })).data,
  del: async (path: string) => void (await session.fetch(path, { method: "DELETE" })),
  /** Uploads a product photo; returns its storage path (see
   * services/api/app/routers/uploads.py). */
  uploadPhoto: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return (await session.fetch<{ storage_path: string }>("/uploads/product-photo", { method: "POST", body: form })).data
      .storage_path;
  },
};
