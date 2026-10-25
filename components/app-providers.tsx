"use client";

import { usePathname } from "next/navigation";
import { AiAssistantProvider } from "@/components/ai/assistant-provider";
import { AiPageScopeProvider } from "@/components/ai/page-context";
import { PdfExportProvider } from "@/components/market-replay/pdf-export-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  // The isolated design preview must not load AI settings, conversations or any business data.
  const pathname = usePathname();
  if (pathname === "/preview/user-growth") return children;
  return <AiPageScopeProvider><AiAssistantProvider><PdfExportProvider>{children}</PdfExportProvider></AiAssistantProvider></AiPageScopeProvider>;
}
