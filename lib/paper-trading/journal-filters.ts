import type { ReplayJournalEntryData } from "./types";
import { compileRExpressionFilter, type RExpressionFilter } from "../trade-journal/r-expression-filter";

export const replayJournalFilterKeys = [
  "initialRiskAbr",
  "actualRiskAbr",
  "actualInitialRiskRatio",
  "abrRr",
  "initialRiskRr",
  "actualRiskRr",
] as const;

export type ReplayJournalFilterKey = (typeof replayJournalFilterKeys)[number];
export type ReplayJournalFilters = Record<ReplayJournalFilterKey, string>;

export function createEmptyReplayJournalFilters(): ReplayJournalFilters {
  return {
    initialRiskAbr: "",
    actualRiskAbr: "",
    actualInitialRiskRatio: "",
    abrRr: "",
    initialRiskRr: "",
    actualRiskRr: "",
  };
}

export function readReplayJournalFilters(searchParams: URLSearchParams): ReplayJournalFilters {
  const filters = createEmptyReplayJournalFilters();
  for (const key of replayJournalFilterKeys) filters[key] = searchParams.get(key) ?? "";
  return filters;
}

export function compileReplayJournalFilters(filters: ReplayJournalFilters) {
  const compiled = new Map<ReplayJournalFilterKey, RExpressionFilter>();
  for (const key of replayJournalFilterKeys) {
    const filter = compileRExpressionFilter(filters[key]);
    if (filter.error) return { error: filter.error, test: () => true };
    compiled.set(key, filter);
  }

  return {
    error: null,
    test: (entry: ReplayJournalEntryData) => replayJournalFilterKeys.every((key) => {
      const expression = filters[key].trim();
      if (expression === "") return true;
      const value = entry[key];
      return value !== null && compiled.get(key)!.test(value);
    }),
  };
}

export function hasActiveReplayJournalFilters(filters: ReplayJournalFilters) {
  return replayJournalFilterKeys.some((key) => filters[key].trim() !== "");
}
