import { copy } from "@/lib/i18n";
import type { ReplayJournalExpressionFilterKey, ReplayJournalOptionFilterKey } from "./journal-filters";
import type { ReplayJournalEntryData } from "./types";
import { utcDateParts } from "@/lib/market-replay/display-timezone";

export type JournalColumnId = "no" | "date" | "direction" | "setup" | "reason" | "abr" | "initialRisk" | "initialRiskAbr" | "actualRisk" | "actualRiskAbr" | "actualInitialRiskRatio" | "gainLoss" | "result" | "abrRr" | "initialRiskRr" | "actualRiskRr" | "review";
export const journalColumns: { id: JournalColumnId; label: string; text: boolean; defaultWidth: number; expressionFilterKey?: ReplayJournalExpressionFilterKey; optionFilterKey?: ReplayJournalOptionFilterKey }[] = [
  { id: "no", label: copy.paperTrading.journalFields.no, text: false, defaultWidth: 72 },
  { id: "date", label: copy.paperTrading.journalFields.date, text: false, defaultWidth: 120 },
  { id: "direction", label: copy.paperTrading.journalFields.direction, text: false, defaultWidth: 112, optionFilterKey: "directions" },
  { id: "setup", label: copy.paperTrading.setup, text: true, defaultWidth: 208, optionFilterKey: "setupOptionIds" },
  { id: "reason", label: copy.paperTrading.tradeReason, text: true, defaultWidth: 256, optionFilterKey: "tradeReasonIds" },
  { id: "abr", label: copy.paperTrading.journalFields.abr, text: false, defaultWidth: 104 },
  { id: "initialRisk", label: copy.paperTrading.journalFields.initialRisk, text: false, defaultWidth: 104 },
  { id: "initialRiskAbr", label: copy.paperTrading.journalFields.initialRiskAbr, text: false, defaultWidth: 128, expressionFilterKey: "initialRiskAbr" },
  { id: "actualRisk", label: copy.paperTrading.journalFields.actualRisk, text: false, defaultWidth: 104 },
  { id: "actualRiskAbr", label: copy.paperTrading.journalFields.actualRiskAbr, text: false, defaultWidth: 128, expressionFilterKey: "actualRiskAbr" },
  { id: "actualInitialRiskRatio", label: copy.paperTrading.journalFields.actualInitialRiskRatio, text: false, defaultWidth: 128, expressionFilterKey: "actualInitialRiskRatio" },
  { id: "gainLoss", label: copy.paperTrading.journalFields.gainLoss, text: false, defaultWidth: 128 },
  { id: "result", label: copy.paperTrading.journalFields.result, text: false, defaultWidth: 104, optionFilterKey: "results" },
  { id: "abrRr", label: copy.paperTrading.journalFields.abrRr, text: false, defaultWidth: 112, expressionFilterKey: "abrRr" },
  { id: "initialRiskRr", label: copy.paperTrading.journalFields.initialRiskRr, text: false, defaultWidth: 112, expressionFilterKey: "initialRiskRr" },
  { id: "actualRiskRr", label: copy.paperTrading.journalFields.actualRiskRr, text: false, defaultWidth: 112, expressionFilterKey: "actualRiskRr" },
  { id: "review", label: copy.paperTrading.review, text: true, defaultWidth: 288 },
];

export function journalFieldValue(entry: ReplayJournalEntryData, id: JournalColumnId): string {
  if (id === "no") return String(entry.no);
  if (id === "date") { const p = utcDateParts(entry.openedAt, entry.displayUtcOffsetMinutes); return `${p.year}/${p.month}/${p.day}`; }
  if (id === "direction") return entry.direction === "LONG" ? copy.paperTrading.long : copy.paperTrading.short;
  if (id === "setup") return entry.setupOption?.name ?? copy.common.dash;
  if (id === "reason") return entry.tradeReasons.map((r) => r.name).join("、") || copy.common.dash;
  if (id === "review") return entry.review || copy.common.dash;
  if (id === "result") return entry.result;
  const value = id === "abr" ? entry.abrValue : entry[id];
  return value === null || !Number.isFinite(value) ? copy.common.dash : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 8 }).format(value);
}
