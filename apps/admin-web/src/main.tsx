// The admin app's entry point: the data cache, the session, toasts and the
// router -- which URL shows which page. A single-page app: the server
// (Caddy, see deploy/Caddyfile) serves index.html for every path and the
// router takes it from there, so links like /products/<id> work when
// opened directly or refreshed.
import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router";

import { Layout } from "@/components/Layout";
import { ToastProvider } from "@/components/overlay";
import { PageLoading } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ForgotPasswordPage, LoginPage, SetPasswordPage } from "@/pages/auth";
import { CashUpPage } from "@/pages/CashUp";
import { CustomerDetailPage, CustomersPage } from "@/pages/Customers";
import { ActivityPage } from "@/pages/Activity";
import { DashboardPage } from "@/pages/Dashboard";
import { InventoryPage } from "@/pages/Inventory";
import { OrderDetailPage, OrdersPage } from "@/pages/Orders";
import { PosPage } from "@/pages/Pos";
import { ProductDetailPage } from "@/pages/ProductDetail";
import { ProductsPage } from "@/pages/Products";
import { ReportsPage } from "@/pages/Reports";
import { SalesJournalPage } from "@/pages/SalesJournal";
import { ShopSettingsPage } from "@/pages/ShopSettings";
import { AccountPage, CategoriesPage, StaffPage } from "@/pages/Settings";
import { WebsitePage } from "@/pages/Website";

// Data is cached briefly and refetched when the window regains focus, so a
// tab left open at the counter catches up with sales made elsewhere.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

/** Signed-in pages: wait for the saved session to be checked, send
 * signed-out visitors to /login, and hold anyone who owes a password change
 * on /set-password until they've made it. */
function RequireAuth() {
  const { status, mustChangePassword } = useAuth();
  if (status === "loading") return <PageLoading />;
  if (status === "signedOut") return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/set-password" replace />;
  return <Outlet />;
}

/** "/" lands on the most useful page for the role: the dashboard for those
 * who can see it, otherwise the product list. */
function Home() {
  const { can } = useAuth();
  return <Navigate to={can.manageCatalog ? "/dashboard" : "/products"} replace />;
}

// Signed-out pages first, then everything behind RequireAuth, inside the
// sidebar Layout. Pages check permissions themselves (and the API enforces
// them regardless); the sidebar only hides links a role can't use.
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/set-password", element: <SetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Home /> },
          { path: "dashboard", element: <DashboardPage /> },
          { path: "reports", element: <ReportsPage /> },
          { path: "sales", element: <SalesJournalPage /> },
          { path: "activity", element: <ActivityPage /> },
          { path: "pos", element: <PosPage /> },
          { path: "cash-up", element: <CashUpPage /> },
          { path: "orders", element: <OrdersPage /> },
          { path: "orders/:id", element: <OrderDetailPage /> },
          { path: "customers", element: <CustomersPage /> },
          { path: "customers/:id", element: <CustomerDetailPage /> },
          { path: "products", element: <ProductsPage /> },
          { path: "products/:id", element: <ProductDetailPage /> },
          { path: "inventory", element: <InventoryPage /> },
          { path: "categories", element: <CategoriesPage /> },
          { path: "staff", element: <StaffPage /> },
          { path: "account", element: <AccountPage /> },
          { path: "settings", element: <ShopSettingsPage /> },
          { path: "website", element: <WebsitePage /> },
          // An unknown address goes to the home page rather than a dead end.
          { path: "*", element: <Home /> },
        ],
      },
    ],
  },
]);

// Providers, outermost first: the data cache, the session, toasts, then
// the router -- so every page can use all three. StrictMode runs extra
// checks in development only.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
