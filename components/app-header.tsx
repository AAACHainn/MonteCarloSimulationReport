"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { UserEntry } from "@/components/user-growth/user-entry";
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
  if (/^\/market-replay\/[^/]+(?:\/history\/[^/]+)?\/?$/.test(pathname)) return null;

  return (
    <header className="border-b bg-white dark:bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Link href="/" className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-sm font-semibold uppercase tracking-wide text-slate-900 dark:text-foreground">
          <Image src="/icon.svg" alt="" aria-hidden="true" width={28} height={28} unoptimized className="h-7 w-7 shrink-0" />
          <span>{copy.nav.brand}</span>
        </Link>
        <nav className="flex items-center gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 dark:text-secondary-text hover:bg-slate-100 dark:hover:bg-hover hover:text-slate-950 dark:hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {pathname !== "/preview/user-growth" && !/^\/market-replay\/[^/]+\/trade-history\/?$/.test(pathname) && <UserEntry />}
      </div>
    </header>
  );
}
