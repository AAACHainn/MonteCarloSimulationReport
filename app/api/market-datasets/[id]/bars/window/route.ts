import { NextResponse } from "next/server";
import { prisma, replayDatabaseQueryCount } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { readExportWindow } from "@/lib/market-replay/export-window";
import { AggregationNotReadyError } from "@/lib/market-replay/aggregation-storage";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import {
  isValidDisplayInterval,
  type AggregatedMarketBarData,
} from "@/lib/market-replay/types";
import { replayWindowSchema } from "@/lib/validations";
import { attachReplayDiagnostics } from "@/lib/market-replay/server-diagnostics";

type RouteContext = { params: Promise<{ id: string }> };
const SOURCE_BAR_SELECT = {
  sequence: true,
  timestamp: true,
  open: true,
  high: true,
  low: true,
  close: true,
  volume: true,
} as const;

export async function GET(request: Request, context: RouteContext) {
  const startedAt = performance.now();
  const queryStart = replayDatabaseQueryCount();
  const { id } = await context.params;
  const url = new URL(request.url);
  const parsed = replayWindowSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const datasetStartedAt = performance.now();
  const dataset = await prisma.marketDataset.findUnique({ where: { id } });
  const datasetDuration = performance.now() - datasetStartedAt;
  if (!dataset || dataset.status !== "READY") return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const sourceSeconds = datasetSourceInterval(dataset);
  if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, parsed.data.displayIntervalSeconds)) {
    return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
  }
  const maximumEndSequence = Math.min(parsed.data.endSequence, dataset.barCount - 1);
  const focusSequence = parsed.data.focusSequence === undefined
    ? null : Math.min(parsed.data.focusSequence, maximumEndSequence);
  const sourceMultiplier = parsed.data.displayIntervalSeconds / sourceSeconds;
  const endSequence = focusSequence === null
    ? maximumEndSequence
    : Math.min(maximumEndSequence, focusSequence + Math.ceil(parsed.data.visibleCount / 2) * sourceMultiplier);
  if (endSequence < 0) return NextResponse.json({
    visibleBars: [], warmupBars: [], lastSourceBar: null, nextEndSequence: null, hasEarlierBars: false,
  });

  const session = resolveDisplaySession(dataset, parsed.data.displaySession);
  if (!session) return NextResponse.json({ error: copy.marketReplay.unsupportedDisplaySession }, { status: 400 });
  const wanted = parsed.data.visibleCount + parsed.data.warmupCount;
  const lastSourceBar = serializeSourceBar(await prisma.marketBar.findUniqueOrThrow({
    where: { datasetId_sequence: { datasetId: id, sequence: endSequence } },
    select: SOURCE_BAR_SELECT,
  }));
  let aggregated: AggregatedMarketBarData[];
  const strategy = "time-aggregate";
  const windowStartedAt = performance.now();
  const metrics = { sourceRows: 0, summaryRows: 0 };
  try {
    const result = await readExportWindow({ dataset, datasetId: id, anchorSequence: endSequence,
      direction: "backward", count: wanted, warmupCount: 0, endSequence,
      sourceSeconds, displaySeconds: parsed.data.displayIntervalSeconds, session, finalSequence: dataset.barCount - 1, metrics });
    aggregated = result.bars;
  } catch (error) {
    if (error instanceof AggregationNotReadyError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    throw error;
  }
  const window = aggregated.slice(-wanted);
  const visibleFrom = Math.max(0, window.length - parsed.data.visibleCount);
  const visibleBars = window.slice(visibleFrom);
  const firstVisibleSequence = visibleBars[0]?.firstSequence ?? 0;
  const nextEndSequence = firstVisibleSequence > 0 ? firstVisibleSequence - 1 : null;
  const response = NextResponse.json({
    warmupBars: window.slice(0, visibleFrom),
    visibleBars,
    lastSourceBar,
    nextEndSequence,
    hasEarlierBars: nextEndSequence !== null,
    aggregationGenerationId: dataset.activeAggregationId,
    focusBarIndex: focusSequence === null ? null : window.slice(visibleFrom).findIndex((bar) => (
      focusSequence >= bar.firstSequence && focusSequence <= bar.lastSequence
    )),
  });
  response.headers.set("X-Replay-Source-Rows", String(metrics.sourceRows));
  response.headers.set("X-Replay-Summary-Rows", String(metrics.summaryRows));
  return attachReplayDiagnostics(response, {
    startedAt,
    queryStart,
    strategy,
    phases: {
      dataset: datasetDuration,
      window: performance.now() - windowStartedAt,
    },
  });
}
