import { compileRExpressionFilter } from "@/lib/trade-journal/r-expression-filter";
import { compileStrategyCodeRegex, type StrategyCodeRegexFilter } from "@/lib/trade-journal/strategy-code-filter";
import { matchesAnyTag, type TradeTagValue } from "@/lib/trade-journal/tags";

export type TradeOption = {
  id: string;
  type: "INSTRUMENT" | "STRATEGY";
  name: string;
  active: boolean;
};

export type JournalTradeRow = {
  id: string;
  date: string;
  direction: string | null;
  riskAmount: number | null;
  rMultiple: number;
  instrumentOptionId: string | null;
  strategyOptionId: string | null;
  instrumentOption: { name: string } | null;
  strategyOption: { name: string } | null;
  entryPrice: number | null;
  stopLossPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  strategyCode: string | null;
  screenshotPath: string | null;
  tags: TradeTagValue[];
};

export type Draft = {
  date: string;
  instrumentOptionId: string;
  strategyOptionId: string;
  entryPrice: string;
  stopLossPrice: string;
  riskAmount: string;
  targetPrice: string;
  exitPrice: string;
  strategyCode: string;
  screenshot: File | null;
};

export type SortKey = "date" | "rMultiple";
export type SortDirection = "asc" | "desc";
export type SortState = {
  key: SortKey;
  direction: SortDirection;
};
export type DirectionFilter = "ALL" | "LONG" | "SHORT";
export type Filters = {
  instrumentOptionId: string;
  strategyOptionIds: string[];
  tagIds: string[];
  direction: DirectionFilter;
  dateFrom: string;
  dateTo: string;
  rExpression: string;
  strategyCodeRegex: string;
};

export const emptyDraft: Draft = {
  date: "",
  instrumentOptionId: "",
  strategyOptionId: "",
  entryPrice: "",
  stopLossPrice: "",
  riskAmount: "",
  targetPrice: "",
  exitPrice: "",
  strategyCode: "",
  screenshot: null,
};

export const pageSizeOptions = Array.from({ length: 10 }, (_, index) => (index + 1) * 10);
export const acceptedScreenshotTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const allFilterValue = "ALL";
export const defaultSortDirections: Record<SortKey, SortDirection> = {
  date: "asc",
  rMultiple: "desc",
};
export const emptyFilters: Filters = {
  instrumentOptionId: allFilterValue,
  strategyOptionIds: [],
  tagIds: [],
  direction: allFilterValue,
  dateFrom: "",
  dateTo: "",
  rExpression: "",
  strategyCodeRegex: "",
};

export function buildTradeOptionFilters(rows: JournalTradeRow[], type: "instrument" | "strategy") {
  const optionMap = new Map<string, string>();

  rows.forEach((row) => {
    const id = type === "instrument" ? row.instrumentOptionId : row.strategyOptionId;
    const name = type === "instrument" ? row.instrumentOption?.name : row.strategyOption?.name;
    if (id && name) optionMap.set(id, name);
  });

  return Array.from(optionMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function buildTradeTagFilters(rows: JournalTradeRow[]) {
  const tagsById = new Map<string, string>();
  rows.forEach((row) => row.tags.forEach((tag) => tagsById.set(tag.id, tag.name)));
  return Array.from(tagsById, ([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function areFiltersEmpty(filters: Filters) {
  return filters.instrumentOptionId === allFilterValue
    && filters.strategyOptionIds.length === 0
    && filters.tagIds.length === 0
    && filters.direction === "ALL"
    && filters.dateFrom === ""
    && filters.dateTo === ""
    && filters.strategyCodeRegex.trim() === ""
    && !isRFilterActive(filters);
}

export function isRFilterActive(filters: Filters) {
  return filters.rExpression.trim() !== "";
}

export function matchesFilters(
  trade: JournalTradeRow,
  filters: Filters,
  strategyCodeFilter: StrategyCodeRegexFilter,
) {
  if (filters.instrumentOptionId !== allFilterValue && trade.instrumentOptionId !== filters.instrumentOptionId) return false;
  if (filters.strategyOptionIds.length > 0 && (!trade.strategyOptionId || !filters.strategyOptionIds.includes(trade.strategyOptionId))) return false;
  if (!matchesAnyTag(trade.tags, filters.tagIds)) return false;
  if (!strategyCodeFilter.test(trade.strategyCode)) return false;
  if (filters.direction !== "ALL" && trade.direction !== filters.direction) return false;
  if (filters.dateFrom && (!trade.date || trade.date < filters.dateFrom)) return false;
  if (filters.dateTo && (!trade.date || trade.date > filters.dateTo)) return false;

  return matchesRFilter(trade.rMultiple, filters);
}

export function matchesRFilter(rMultiple: number, filters: Filters) {
  return compileRExpressionFilter(filters.rExpression).test(rMultiple);
}

export function getVisibleRows(rows: JournalTradeRow[], filters: Filters) {
  const strategyCodeFilter = compileStrategyCodeRegex(filters.strategyCodeRegex);
  return rows.filter((trade) => matchesFilters(trade, filters, strategyCodeFilter));
}

export function getSortedRows(rows: JournalTradeRow[], sort: SortState) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      const result = sort.key === "date"
        ? a.row.date.localeCompare(b.row.date)
        : a.row.rMultiple - b.row.rMultiple;

      return result === 0 ? a.index - b.index : result * direction;
    })
    .map(({ row }) => row);
}

export function serializeApiTrade(trade: JournalTradeRow & { date: string }) {
  return { ...trade, date: trade.date.slice(0, 10) };
}
