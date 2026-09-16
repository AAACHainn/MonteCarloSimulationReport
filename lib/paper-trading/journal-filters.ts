import type { ReplayJournalEntryData } from "./types";
import { compileRExpressionFilter, type RExpressionFilter } from "../trade-journal/r-expression-filter";

export const replayJournalExpressionFilterKeys = [
  "initialRiskAbr",
  "actualRiskAbr",
  "actualInitialRiskRatio",
  "abrRr",
  "initialRiskRr",
  "actualRiskRr",
] as const;

export type ReplayJournalExpressionFilterKey = (typeof replayJournalExpressionFilterKeys)[number];
export type ReplayJournalOptionFilterKey = "directions" | "setupOptionIds" | "results";
export type ReplayJournalFilters = Record<ReplayJournalExpressionFilterKey, string> & {
  directions: ReplayJournalEntryData["direction"][];
  setupOptionIds: string[];
  results: ReplayJournalEntryData["result"][];
};

export const NO_SETUP_FILTER_VALUE = "__NO_SETUP__";

export function createEmptyReplayJournalFilters(): ReplayJournalFilters {
  return {
    initialRiskAbr: "",
    actualRiskAbr: "",
    actualInitialRiskRatio: "",
    abrRr: "",
    initialRiskRr: "",
    actualRiskRr: "",
    directions: [],
    setupOptionIds: [],
    results: [],
  };
}

export function readReplayJournalFilters(searchParams: URLSearchParams): ReplayJournalFilters {
  const filters = createEmptyReplayJournalFilters();
  for (const key of replayJournalExpressionFilterKeys) filters[key] = searchParams.get(key) ?? "";
  filters.directions = unique(searchParams.getAll("directions"))
    .filter((value): value is ReplayJournalEntryData["direction"] => value === "LONG" || value === "SHORT");
  filters.setupOptionIds = unique(searchParams.getAll("setupOptionIds").map((value) => value.trim()).filter(Boolean));
  filters.results = unique(searchParams.getAll("results"))
    .filter((value): value is ReplayJournalEntryData["result"] => value === "W" || value === "L" || value === "BE");
  return filters;
}

export function compileReplayJournalFilters(filters: ReplayJournalFilters) {
  const compiled = new Map<ReplayJournalExpressionFilterKey, RExpressionFilter>();
  for (const key of replayJournalExpressionFilterKeys) {
    const filter = compileRExpressionFilter(filters[key]);
    if (filter.error) return { error: filter.error, test: () => true };
    compiled.set(key, filter);
  }

  return {
    error: null,
    test: (entry: ReplayJournalEntryData) => {
      if (filters.directions.length > 0 && !filters.directions.includes(entry.direction)) return false;
      const setupValue = entry.setupOptionId ?? NO_SETUP_FILTER_VALUE;
      if (filters.setupOptionIds.length > 0 && !filters.setupOptionIds.includes(setupValue)) return false;
      if (filters.results.length > 0 && !filters.results.includes(entry.result)) return false;

      return replayJournalExpressionFilterKeys.every((key) => {
        const expression = filters[key].trim();
        if (expression === "") return true;
        const value = entry[key];
        return value !== null && compiled.get(key)!.test(value);
      });
    },
  };
}

export function hasActiveReplayJournalFilters(filters: ReplayJournalFilters) {
  return countActiveReplayJournalFilters(filters) > 0;
}

export function countActiveReplayJournalFilters(filters: ReplayJournalFilters) {
  return replayJournalExpressionFilterKeys.filter((key) => filters[key].trim() !== "").length
    + Number(filters.directions.length > 0)
    + Number(filters.setupOptionIds.length > 0)
    + Number(filters.results.length > 0);
}

function unique<Value>(values: Value[]) {
  return [...new Set(values)];
}
