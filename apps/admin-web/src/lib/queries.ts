// Queries several screens share. Categories change rarely, so they're
// cached for longer than the default.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "./api";
import type { Category } from "./types";

// All categories, in menu order -- cached for 5 minutes.
export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/categories"), staleTime: 5 * 60_000 });
}

/** A value that only updates once the input has been still for `ms` --
 * so typing in a search box sends one request, not one per keystroke. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
