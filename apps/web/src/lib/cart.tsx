"use client";

// The shopping cart: kept in the browser (localStorage), so it survives a
// reload and needs no account. Prices and stock here are what the shopper
// saw when adding the item -- checkout (POST /orders/checkout) re-prices
// every line and re-checks stock on the server, which is what actually
// counts.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "belpok.web.cart";

// The order just placed, handed from checkout to the confirmation page
// (sessionStorage: it only needs to survive that one navigation).
export const LAST_ORDER_KEY = "belpok.web.lastOrder";

export type CartLine = {
  variantId: string;
  productSlug: string;
  productName: string;
  size: string;
  color: string | null;
  unitPrice: number;
  imagePath: string | null;
  quantity: number;
  // Stock when added -- caps the quantity stepper so nobody builds a cart
  // that checkout will just reject.
  maxQuantity: number;
};

type CartState = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  add: (line: Omit<CartLine, "quantity">, quantity: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  // The slide-out cart that opens after "Add to cart".
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
};

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Read once on mount (localStorage doesn't exist during server rendering).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setLines(JSON.parse(saved) as CartLine[]);
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {}
  }, [lines, loaded]);

  const add = useCallback((line: Omit<CartLine, "quantity">, quantity: number) => {
    setLines((current) => {
      const existing = current.find((l) => l.variantId === line.variantId);
      if (existing) {
        return current.map((l) =>
          l.variantId === line.variantId
            ? { ...l, ...line, quantity: Math.min(l.quantity + quantity, line.maxQuantity) }
            : l,
        );
      }
      return [...current, { ...line, quantity: Math.min(quantity, line.maxQuantity) }];
    });
  }, []);

  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setLines((current) =>
      current
        .map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(quantity, l.maxQuantity) } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const remove = useCallback((variantId: string) => {
    setLines((current) => current.filter((l) => l.variantId !== variantId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartState>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
      drawerOpen,
      setDrawerOpen,
    }),
    [lines, add, setQuantity, remove, clear, drawerOpen],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
