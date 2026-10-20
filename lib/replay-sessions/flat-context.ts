import type { MarketBar, MarketDataset } from "@prisma/client";
import { readExportWindow } from "@/lib/market-replay/export-window";
import { mergeSourceBarInto } from "@/lib/market-replay/aggregation";
import { datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { calculateLatestAbr } from "@/lib/market-replay/abr";
import { barEmissionMode } from "@/lib/market-replay/bar-quality";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";
import { appendContextRun, type ReplayContextRun } from "./context-runs";

type StoredRun = { fromSequence: number; toSequence: number; context: string };

/** Deferred work belongs to explicit correction, never the ordinary empty-account click. */
export async function materializeFlatContexts(dataset: MarketDataset, bars: MarketBar[], runs: StoredRun[]): Promise<StoredRun[]> {
  const expanded: StoredRun[] = [];
  for (const run of runs) {
    const metadata = JSON.parse(run.context) as Pick<ReplayContextRun, "generation" | "context" | "flatAdvance">;
    const recipe = metadata.flatAdvance;
    if (!recipe) { expanded.push(run); continue; }
    if (recipe.kind !== "FLAT_ADVANCE_V1" || recipe.historyVersion !== dataset.historyVersion) throw new Error("Invalid deferred replay context.");
    const selected = bars.filter(bar => bar.sequence >= run.fromSequence && bar.sequence <= run.toSequence);
    if (!selected.length) continue;
    const session = resolveDisplaySession(dataset, recipe.displaySession);
    const sourceSeconds = datasetSourceInterval(dataset);
    if (!session || !sourceSeconds) throw new Error("Invalid deferred replay session.");
    let anchor = selected[0].sequence - 1;
    const revealed = anchor;
    const historyStart = recipe.abrHistoryStartSequence ?? 0;
    const pages: AggregatedMarketBarData[][] = [];
    let count = 0;
    // Custom periods may need several bounded pages to restore a long ABR warmup.
    while (anchor >= historyStart && count < recipe.abrLength) {
      const page = await readExportWindow({ dataset, datasetId: dataset.id,
        anchorSequence: anchor, endSequence: revealed, direction: "backward", count: recipe.abrLength - count, warmupCount: 0,
        sourceSeconds, displaySeconds: recipe.displayIntervalSeconds, session });
      const history = page.bars.filter(bar => bar.lastSequence >= historyStart);
      if (!history.length) break;
      pages.unshift(history); count += history.length;
      const previous = history[0].firstSequence - 1;
      if (previous >= anchor) throw new Error("Deferred ABR history did not advance.");
      anchor = previous;
    }
    let aggregates = pages.flat().slice(-recipe.abrLength);
    const contexts: ReplayContextRun[] = [];
    for (const raw of selected) {
      const abrValue = calculateLatestAbr([], aggregates, recipe.abrLength);
      appendContextRun(contexts, raw.sequence, { abrValue: abrValue !== null && abrValue > 0 ? abrValue : null,
        abrLength: recipe.abrLength, displayIntervalSeconds: recipe.displayIntervalSeconds,
        displaySession: recipe.displaySession, displayUtcOffsetMinutes: recipe.displayUtcOffsetMinutes,
        priceTickSize: recipe.priceTickSize }, metadata.generation);
      mergeSourceBarInto(aggregates, serializeSourceBar(raw), { sourceSeconds, displaySeconds: recipe.displayIntervalSeconds,
        session, finalSequence: dataset.barCount - 1, emissionMode: barEmissionMode(dataset.barEmissionMode) });
      if (aggregates.length > recipe.abrLength) aggregates = aggregates.slice(-recipe.abrLength);
    }
    expanded.push(...contexts.map(({ fromSequence, toSequence, generation, context }) => ({ fromSequence, toSequence,
      context: JSON.stringify({ generation, context }) })));
  }
  return expanded;
}
