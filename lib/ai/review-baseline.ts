import { createHash } from "node:crypto";
import type { ReplayJournalEntryData } from "@/lib/paper-trading/types";
import { logicalId } from "@/lib/replay-sessions/identity";
type Facts = Partial<Omit<ReplayJournalEntryData, "openedAt" | "closedAt" | "discipline" | "direction" | "entryOrderType" | "displaySession">> & { direction?: string; displaySession?: string; entryOrderType?: string | null; openedAt?: string | Date; closedAt?: string | Date; logicalKey?: string | null; discipline?: unknown; disciplineContentHash?: string };
export function reviewFactsHash(entry: Facts) {
  let discipline = entry.discipline;
  if (typeof discipline === "string") { try { discipline = JSON.parse(discipline); } catch { discipline = { corrupt: discipline }; } }
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return digest({ key: entry.logicalKey ?? logicalId(entry.id ?? ""), quantity: entry.quantity, direction: entry.direction, openedSequence: entry.openedSequence, closedSequence: entry.closedSequence,
    openedAt: entry.openedAt ? new Date(entry.openedAt).toISOString() : null, closedAt: entry.closedAt ? new Date(entry.closedAt).toISOString() : null,
    entryPrice: entry.entryPrice, exitPrice: entry.exitPrice, entryOrderType: entry.entryOrderType, initialStopPrice: entry.initialStopPrice,
    initialRisk: entry.initialRisk, actualRisk: entry.actualRisk, gainLoss: entry.gainLoss, abrValue: entry.abrValue, abrLength: entry.abrLength,
    displayIntervalSeconds: entry.displayIntervalSeconds, displaySession: entry.displaySession, priceTickSize: entry.priceTickSize,
    setupOptionId: entry.setupOptionId, setupOption: entry.setupOption, tradeReasons: [...(entry.tradeReasons ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    disciplineHash: entry.disciplineContentHash ?? digest(discipline ?? null) });
}
