"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { copy } from "@/lib/i18n";

const navItems = [
  { href: "/market-replay", label: copy.nav.marketReplay },
  { href: "/datasets", label: copy.nav.datasets },
  { href: "/trade-journals", label: copy.nav.tradeJournals },
  { href: "/master-data", label: copy.nav.masterData },
  { href: "/simulations/new", label: copy.nav.newSimulation },
  { href: "/simulations/history", label: copy.nav.history },
];

export function AppHeader() {
  const pathname = usePathname();
  if (/^\/market-replay\/[^/]+\/?$/.test(pathname)) return null;

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-mono text-sm font-semibold uppercase tracking-wide text-slate-900">
          {copy.nav.brand}
        </Link>
        <nav className="flex items-center gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
