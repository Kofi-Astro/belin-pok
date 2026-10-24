// The admin's frame: sidebar navigation (grouped Overview / Sell / Stock /
// Team, showing only what the signed-in person's roles allow), the
// signed-in person with Account and Sign out, and the page itself
// (<Outlet />, filled in by the router -- see main.tsx).
import clsx from "clsx";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  Globe,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  ScanBarcode,
  Settings,
  Shirt,
  SlidersHorizontal,
  Tags,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";

import { type Permissions, useAuth } from "@/lib/auth";
import { titleCase } from "@/lib/format";

import { Avatar } from "./ui";

// A sidebar link. show: who sees it (everyone, if omitted).
type NavItem = { to: string; label: string; icon: LucideIcon; show?: (can: Permissions) => boolean };

// Grouped the way the shop works: selling, managing stock, managing people.
// `show` mirrors what each role can actually do on the API, so nobody sees
// a section they'd only get "not permitted" from.
const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: (c) => c.manageCatalog },
      { to: "/reports", label: "Sales reports", icon: BarChart3, show: (c) => c.manageCatalog },
      { to: "/sales", label: "Sales journal", icon: ReceiptText, show: (c) => c.manageCatalog },
      { to: "/activity", label: "Activity log", icon: History, show: (c) => c.isOwner },
    ],
  },
  {
    heading: "Sell",
    items: [
      { to: "/pos", label: "Point of sale", icon: ScanBarcode, show: (c) => c.adjustStock },
      { to: "/orders", label: "Online orders", icon: ClipboardList },
      { to: "/customers", label: "Customers", icon: Users },
    ],
  },
  {
    heading: "Stock",
    items: [
      { to: "/products", label: "Products", icon: Shirt },
      { to: "/inventory", label: "Inventory", icon: Boxes },
      { to: "/categories", label: "Categories", icon: Tags, show: (c) => c.manageCatalog },
    ],
  },
  {
    heading: "Online shop",
    items: [{ to: "/website", label: "Website", icon: Globe, show: (c) => c.manageCatalog }],
  },
  {
    heading: "Team",
    items: [
      { to: "/staff", label: "Staff", icon: UserCog, show: (c) => c.isOwner },
      { to: "/settings", label: "Shop settings", icon: SlidersHorizontal, show: (c) => c.isOwner },
    ],
  },
];

// The sidebar's contents, used both fixed (desktop) and slide-out
// (tablet/phone). onNavigate closes the slide-out after a tap.
function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { staff, can, signOut } = useAuth();
  return (
    <div className="flex h-full flex-col bg-brand-950 text-white/80">
      <div className="flex items-center gap-3 px-5 py-5">
        <img src="/icon.png" alt="" className="h-9 w-9 rounded-lg" />
        <div className="leading-tight">
          <p className="font-bold text-white">Belin-Pok</p>
          <p className="text-[11px] font-medium tracking-wider text-white/50 uppercase">Inventory &amp; sales</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {NAV.map((group) => {
          // Hide links this person can't use, and a heading left with none.
          const items = group.items.filter((i) => !i.show || i.show(can));
          if (!items.length) return null;
          return (
            <div key={group.heading}>
              <p className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-white/40 uppercase">{group.heading}</p>
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive ? "bg-white/12 text-white" : "hover:bg-white/6 hover:text-white",
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* Who's signed in (name and roles), with Account and Sign out. */}
      {staff && (
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <Avatar name={staff.full_name} className="bg-white/15 text-white" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{staff.full_name}</p>
              <p className="truncate text-xs text-white/50">{staff.roles.map(titleCase).join(" + ")}</p>
            </div>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <NavLink to="/account" onClick={onNavigate} className="flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium hover:bg-white/6 hover:text-white">
              <Settings className="h-3.5 w-3.5" /> Account
            </NavLink>
            <button type="button" onClick={() => void signOut()} className="flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium hover:bg-white/6 hover:text-white">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The frame around every signed-in page: a fixed sidebar on wide screens,
 * a slide-out one behind a menu button on tablets and phones (the counter
 * tablet included). */
export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // Close the slide-out menu whenever the page changes.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 shadow-2xl">
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        {/* Top bar with the menu button -- below desktop width only. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-black/5" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <Package className="h-5 w-5 text-brand-600" />
          <span className="font-bold">Belin-Pok</span>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
