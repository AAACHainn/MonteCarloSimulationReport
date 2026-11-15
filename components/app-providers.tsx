"use client";

import { isIsolatedPreviewPath } from "@/lib/preview-routes";
import { AppearanceProvider } from "@/components/appearance-provider";

import { CurrentUserProvider } from "@/components/user-growth/user-context";
import { usePathname } from "next/navigation";
import { AiAssistantProvider } from "@/components/ai/assistant-provider";
import { AiPageScopeProvider } from "@/components/ai/page-context";
import { PdfExportProvider } from "@/components/market-replay/pdf-export-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  // The isolated design preview must not load AI settings, conversations or any business data.
  const pathname = usePathname();
  if (isIsolatedPreviewPath(pathname)) return <AppearanceProvider>{children}</AppearanceProvider>;
  return <AppearanceProvider><CurrentUserProvider><AiPageScopeProvider><AiAssistantProvider><PdfExportProvider>{children}</PdfExportProvider></AiAssistantProvider></AiPageScopeProvider></CurrentUserProvider></AppearanceProvider>;
}
