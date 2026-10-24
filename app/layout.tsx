import type { Metadata } from "next";
import { PdfExportProvider } from "@/components/market-replay/pdf-export-provider";
import { AppHeader } from "@/components/app-header";
import { AiAssistantProvider } from "@/components/ai/assistant-provider";
import { AiPageScopeProvider } from "@/components/ai/page-context";
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
        <AiPageScopeProvider><AiAssistantProvider><PdfExportProvider><div className="min-h-screen">
          <AppHeader />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </div></PdfExportProvider></AiAssistantProvider></AiPageScopeProvider>
      </body>
    </html>
  );
}
