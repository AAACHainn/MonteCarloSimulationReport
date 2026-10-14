import { copy } from "@/lib/i18n";
import type { StrategyChecklistItem } from "./training-gate";
import type { ReplayJournalEntryData } from "./types";

export type JournalSetupChecklist = { name: string; checklist: StrategyChecklistItem[]; confirmed: boolean };

/** An editable Setup never changes whether the entry was checked before submission. */
export function journalUsedChecklist(entry: Pick<ReplayJournalEntryData, "discipline">): boolean {
  return Boolean(entry.discipline);
}

export function journalSetupChecklist(
  entry: Pick<ReplayJournalEntryData, "setupOptionId" | "setupOption" | "discipline">,
  strategies: ReadonlyArray<{ id: string; name: string; checklist?: StrategyChecklistItem[] }>,
): JournalSetupChecklist | null {
  if (!entry.setupOptionId) return null;
  if (entry.discipline?.strategyId === entry.setupOptionId) {
    return { name: entry.setupOption?.name ?? entry.discipline.strategyName, checklist: entry.discipline.checklist, confirmed: true };
  }
  const strategy = strategies.find((option) => option.id === entry.setupOptionId);
  return strategy ? { name: entry.setupOption?.name ?? strategy.name, checklist: strategy.checklist ?? [], confirmed: false } : null;
}

export function journalSetupChecklistTitle(details: JournalSetupChecklist): string {
  const heading = details.confirmed ? copy.paperTrading.confirmedSetupChecklist : copy.trainingGate.checklist;
  const items = details.checklist.length ? details.checklist.map((item, index) => `${index + 1}. ${item.text}`).join("\n") : copy.trainingGate.emptyChecklist;
  return `${details.name}\n${heading}\n${items}`;
}
