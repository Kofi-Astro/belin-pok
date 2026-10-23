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
import { CustomerDetailPage, CustomersPage } from "@/pages/Customers";
import { DashboardPage } from "@/pages/Dashboard";
import { InventoryPage } from "@/pages/Inventory";
import { OrderDetailPage, OrdersPage } from "@/pages/Orders";
import { PosPage } from "@/pages/Pos";
import { ProductDetailPage } from "@/pages/ProductDetail";
import { ProductsPage } from "@/pages/Products";
import { AccountPage, CategoriesPage, StaffPage } from "@/pages/Settings";

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
          { path: "pos", element: <PosPage /> },
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
          { path: "*", element: <Home /> },
        ],
      },
    ],
  },
]);

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
