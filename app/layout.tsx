import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { AppProviders } from "@/components/app-providers";
import { copy, defaultLocale } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.nav.brand,
  description: copy.home.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={defaultLocale} suppressHydrationWarning>
      <body>
        <AppProviders><div className="min-h-screen" style={{ "--app-notice-height": process.env.USER_GROWTH_ACCEPTANCE === "1" ? "2rem" : "0px" } as CSSProperties}>
          <AppHeader />
          {process.env.USER_GROWTH_ACCEPTANCE === "1" && <p role="status" className="border-b bg-slate-50 px-6 py-2 text-center text-xs text-slate-600">{copy.userGrowth.stage2} · {copy.userGrowth.stage2Hint}</p>}
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </div></AppProviders>
      </body>
    </html>
  );
}
