import type { JournalColumnId } from "./journal-columns";
import type { ReplayJournalEntryData, ReplayJournalSummary } from "./types";
import type { ReplayJournalFilters } from "./journal-filters";
import type { AggregatedMarketBarData, BarCountIndicatorConfig, DisplaySession, EmaIndicatorConfig, MarketDatasetSummary } from "@/lib/market-replay/types";
import type { CandlestickStyle } from "@/lib/market-replay/candlestick-style";

export const PDF_MAX_BARS = 200;
export const PDF_CHARTS_PER_VOLUME = 50;
export type PdfSnapshot = {
  session: { id: string; name: string; createdAt: string; totalCount: number };
  dataset: MarketDatasetSummary;
  entries: ReplayJournalEntryData[];
  summary: ReplayJournalSummary;
  filters: ReplayJournalFilters;
  filterDescription: string;
  capturedAt: string;
  endSequence: number;
};
export type PdfOptions = { displayIntervalSeconds: number; displaySession: DisplaySession; includeDetails: boolean; detailFieldIds: JournalColumnId[] };
export type PdfChartPreferences = { barCountConfig: BarCountIndicatorConfig; candlestickStyle: CandlestickStyle; emaEnabled: boolean; emaIndicators: EmaIndicatorConfig[]; gridVisible: boolean; volumeVisible: boolean; displayUtcOffsetMinutes: number };
export type PdfWindow = { bars: AggregatedMarketBarData[]; warmupBars: AggregatedMarketBarData[]; previousSequence: number | null; nextSequence: number | null };
export type PdfChartPage = { fromSequence: number; toSequence: number; count: number; entryIds: string[]; beforeCount: number; afterCount: number; part: number; parts: number };
export type PdfVolumeMetadata = { snapshot: PdfSnapshot; options: PdfOptions; preferences: PdfChartPreferences; volume: number; volumes: number; totalCharts: number; chartOffset: number; pages: PdfChartPage[] };
export type PdfWorkerRequest = { id: number } & ({ type: "init"; metadata: PdfVolumeMetadata; font: ArrayBuffer } | { type: "chart"; page: PdfChartPage; png: ArrayBuffer; caption: string } | { type: "finish" });
export type PdfWorkerResponse = { id: number; error?: string; pdf?: ArrayBuffer };
