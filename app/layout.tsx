import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { copy, defaultLocale } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.home.title,
  description: copy.home.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={defaultLocale} suppressHydrationWarning>
      <body>
        <div className="min-h-screen">
          <AppHeader />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
