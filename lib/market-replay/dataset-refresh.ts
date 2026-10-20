import { aggregatePhase, barEmissionMode, BAR_QUALITY_RULE_VERSION, setAggregateState } from "./bar-quality";
import { mergeReplayHistory } from "./history";
import type { AggregatedMarketBarData, MarketDatasetSummary } from "./types";

/** Display semantics can change independently of the append-only source version. */
export function replayDisplayMetadataKey(dataset: MarketDatasetSummary) {
  return JSON.stringify([BAR_QUALITY_RULE_VERSION, barEmissionMode(dataset.barEmissionMode),
    dataset.aggregationGenerationId ?? null, dataset.aggregationRuleVersion ?? 1,
    dataset.symbol, dataset.sourceIntervalSeconds, dataset.timezone, dataset.sessionMode,
    dataset.sessionOpenMinute, dataset.sessionCloseMinute, [...dataset.tradingWeekdays].sort((a, b) => a - b)]);
}

export function replayDatasetUpdate(current: MarketDatasetSummary, next: MarketDatasetSummary) {
  if (current.id !== next.id || (current.historyVersion ?? 1) !== (next.historyVersion ?? 1)) return "history";
  if (replayDisplayMetadataKey(current) !== replayDisplayMetadataKey(next)) return "display";
  if (current.dataVersion !== next.dataVersion || current.barCount !== next.barCount || current.endTime !== next.endTime) return "tail";
  return "none";
}

/** Keep a display revision pending until its window is actually applied. Retry
 * failed, aborted or stale reads serially; disposing fences a late completion.
 */
export function startDisplayMetadataRefresh(options: {
  load: (isActive: () => boolean) => Promise<boolean>;
  applied: () => void;
  failed: (error: unknown) => void;
  shouldRetry?: () => boolean;
}) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function attempt() {
    if (!active || options.shouldRetry?.() === false) return;
    try {
      const applied = await options.load(() => active);
      if (!active) return;
      if (applied) { options.applied(); return; }
    } catch (error) {
      if (active) options.failed(error);
    }
    if (active && options.shouldRetry?.() !== false) timer = setTimeout(() => { void attempt(); }, 5000);
  }
  void attempt();
  return () => { active = false; clearTimeout(timer); };
}

/** Reclassify retained historical candles as well as the fresh tail. Keeping the
 * loaded prefix lets the chart preserve a manually panned viewport during refresh.
 */
export function mergeRefreshedReplayWindow(existing: AggregatedMarketBarData[], warmup: AggregatedMarketBarData[],
  incoming: AggregatedMarketBarData[], incomingWarmup: AggregatedMarketBarData[], warmupCount: number,
  emissionMode: MarketDatasetSummary["barEmissionMode"], endSequence: number) {
  const reclassify = (bars: AggregatedMarketBarData[]) => bars.filter(bar => bar.lastSequence <= endSequence)
    .map(bar => setAggregateState({ ...bar }, aggregatePhase(bar), barEmissionMode(emissionMode)));
  return mergeReplayHistory([reclassify(warmup), reclassify(existing), incomingWarmup, incoming],
    warmupCount, Math.max(existing.length, incoming.length));
}
