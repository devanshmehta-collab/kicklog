"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  ExternalLink,
  Handshake,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  PackageSearch,
  Receipt,
  Settings,
  Store,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { useMe } from "@/components/providers";
import { Spinner } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";

const R = ["owner", "admin", "viewer"];
const GROUPS = [
  {
    label: "Run the day",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard, roles: R },
      { href: "/inventory", label: "Inventory", icon: Boxes, roles: R },
      { href: "/sales", label: "Sales", icon: Receipt, roles: R },
      { href: "/customers", label: "Customers", icon: Users, roles: R },
    ],
  },
  {
    label: "Grow",
    items: [
      { href: "/sourcing", label: "Sourcing", icon: PackageSearch, roles: R },
      { href: "/catalog-manager", label: "Catalog", icon: Store, roles: R },
      { href: "/import", label: "AI Import", icon: Link2, roles: ["owner", "admin"] },
      { href: "/analytics", label: "Analytics", icon: BarChart3, roles: R },
    ],
  },
  {
    label: "Money & admin",
    items: [
      { href: "/partners", label: "Partners", icon: Handshake, roles: [...R, "partner"] },
      { href: "/settings", label: "Settings", icon: Settings, roles: R },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useMe();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (user?.role === "partner" && path !== "/partners") router.replace("/partners");
  }, [loading, user, router, path]);
  React.useEffect(() => setOpen(false), [path]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    qc.clear();
    router.replace("/login");
  }

  const links = (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Main">
      {GROUPS.map((g) => {
        const items = g.items.filter((n) => n.roles.includes(user.role));
        if (!items.length) return null;
        return (
          <div key={g.label}>
            <div className="mb-1.5 px-3 text-[10px] font-medium tracking-[0.2em] text-muted/70 uppercase">{g.label}</div>
            <div className="flex flex-col gap-0.5">
              {items.map(({ href, label, icon: Icon }) => {
                const active = path === href || (href !== "/dashboard" && path.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-raised font-medium text-fg" : "text-muted hover:bg-raised/60 hover:text-fg",
                    )}
                  >
                    {active && <span className="absolute top-1/2 -left-3 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" aria-hidden />}
                    <Icon size={16} className={cn("transition-colors", active ? "text-accent" : "text-muted group-hover:text-fg")} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  const userCard = (
    <div className="flex items-center gap-3 border-t border-line p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent" aria-hidden>
        {user.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="truncate font-medium">{user.name}</div>
        <div className="text-xs text-muted capitalize">{user.role}</div>
      </div>
      <button onClick={logout} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-muted hover:bg-raised hover:text-fg">
        <LogOut size={16} />
      </button>
    </div>
  );

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-sm font-bold text-bg">K</span>
      <span>
        <span className="block text-[13px] leading-none font-semibold tracking-[0.18em]">KICK LOG</span>
        <span className="mt-1 block text-[10px] leading-none text-muted">Less logging. More selling.</span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/60 lg:flex">
        <div className="px-5 pt-5 pb-1">{brand}</div>
        <div className="flex-1 overflow-y-auto scroll-thin">{links}</div>
        <Link href="/" target="_blank" className="mx-3 mb-3 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-xs text-muted hover:border-fg/30 hover:text-fg">
          View public showroom <ExternalLink size={13} />
        </Link>
        {userCard}
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
          {brand}
          <button aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-lg p-2 text-muted hover:bg-raised">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </header>
        {open && (
          <div className="fixed inset-x-0 top-[61px] bottom-0 z-20 flex flex-col overflow-y-auto border-t border-line bg-bg lg:hidden">
            <div className="flex-1">{links}</div>
            <Link href="/" className="mx-3 mb-3 flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm text-muted">
              View public showroom <ExternalLink size={14} />
            </Link>
            {userCard}
          </div>
        )}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
