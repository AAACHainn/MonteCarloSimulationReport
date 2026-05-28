import type { Metadata } from "next";
import Link from "next/link";
import { copy, defaultLocale } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.home.title,
  description: copy.home.description,
};

const navItems = [
  { href: "/datasets", label: copy.nav.datasets },
  { href: "/simulations/new", label: copy.nav.newSimulation },
  { href: "/simulations/history", label: copy.nav.history },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={defaultLocale}>
      <body>
        <div className="min-h-screen">
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
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
