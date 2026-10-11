import { copy } from "@/lib/i18n";
import { journalColumns, type JournalColumnId } from "./journal-columns";
import { replayJournalExpressionFilterKeys, NO_SETUP_FILTER_VALUE, NO_TRADE_REASON_FILTER_VALUE, type ReplayJournalFilters } from "./journal-filters";
import type { ReplayJournalEntryData } from "./types";

export const PDF_DETAIL_STORAGE_KEY = "replay-journal-pdf-details-v1";
export const defaultPdfFieldIds = journalColumns.filter((c) => c.id !== "no").map((c) => c.id);
export function parsePdfDetails(value: string | null): { includeDetails: boolean; detailFieldIds: JournalColumnId[] } {
  try {
    const parsed = JSON.parse(value ?? "null");
    if (parsed && typeof parsed.includeDetails === "boolean" && Array.isArray(parsed.detailFieldIds))
      return { includeDetails: parsed.includeDetails, detailFieldIds: defaultPdfFieldIds.filter((id) => parsed.detailFieldIds.includes(id)) };
  } catch { /* Invalid browser storage uses defaults. */ }
  return { includeDetails: true, detailFieldIds: [...defaultPdfFieldIds] };
}
export function replayFilterSearchParams(filters: ReplayJournalFilters) {
  const params = new URLSearchParams();
  for (const key of replayJournalExpressionFilterKeys) if (filters[key].trim()) params.set(key, filters[key].trim());
  for (const key of ["directions", "setupOptionIds", "tradeReasonIds", "results"] as const)
    for (const value of filters[key]) params.append(key, value);
  return params;
}
export function describePdfFilters(filters: ReplayJournalFilters, entries: ReplayJournalEntryData[]) {
  const parts: string[] = [];
  for (const c of journalColumns) {
    if (c.expressionFilterKey && filters[c.expressionFilterKey].trim()) parts.push(`${c.label}: ${filters[c.expressionFilterKey].trim()}`);
    if (!c.optionFilterKey || !filters[c.optionFilterKey].length) continue;
    const values = filters[c.optionFilterKey].map((v) => {
      if (c.optionFilterKey === "directions") return v === "LONG" ? copy.paperTrading.long : copy.paperTrading.short;
      if (c.optionFilterKey === "setupOptionIds") return v === NO_SETUP_FILTER_VALUE ? copy.common.dash : entries.find((e) => e.setupOptionId === v)?.setupOption?.name ?? v;
      if (c.optionFilterKey === "tradeReasonIds") return v === NO_TRADE_REASON_FILTER_VALUE ? copy.common.dash : entries.flatMap((e) => e.tradeReasons).find((r) => r.id === v)?.name ?? v;
      return v;
    });
    parts.push(`${c.label}: ${values.join("、")}`);
  }
  return parts.join("；") || copy.paperTrading.pdf.noFilters;
}
export function pdfFilename(name: string, capturedAt: string, volume: number, volumes: number) {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().replace(/[. ]+$/g, "").slice(0, 60) || "replay";
  return `${clean}-${capturedAt.replace(/[^0-9]/g, "").slice(0, 14)}-${volume}-of-${volumes}.pdf`;
}
