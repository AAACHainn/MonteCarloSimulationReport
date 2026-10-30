import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { aggregateMarketBars } from "../../lib/market-replay/aggregation";
import { resolveDisplaySession } from "../../lib/market-replay/chart-sessions";
import { datasetSourceInterval } from "../../lib/market-replay/dataset";
import { serializeMarketDrawing, type TrendLineDrawing } from "../../lib/market-replay/chart-drawings";
import { drawingTimelineBars, DrawingTimelineLocator } from "../../lib/market-replay/drawing-timeline";
import { TrendLinePrimitive } from "../../lib/market-replay/trend-line-primitive";
import type { AggregatedMarketBarData, MarketBarData } from "../../lib/market-replay/types";
import type { DatasetAggregationRecord } from "../../lib/market-replay/dataset";
import { resolveSqlitePath } from "../../lib/sqlite-client.mjs";

const require = createRequire(import.meta.url);
if (existsSync(".env")) process.loadEnvFile(".env");
const Database = require("better-sqlite3");
const database = process.argv[2] ?? resolveSqlitePath(process.env.DATABASE_URL!);
// No Prisma client, migrations, journal PRAGMAs or data mutations in this benchmark.
const db = new Database(database, { readonly: true, fileMustExist: true });
let dataset: DatasetAggregationRecord & { id: string; symbol: string };
let source: MarketBarData[];
let drawings: TrendLineDrawing[];
let progress: { currentSequence: number };
try {
  const replay = db.prepare(`SELECT r.id,r.datasetId FROM ReplaySession r JOIN MarketDataset d ON d.id=r.datasetId
    WHERE d.symbol='ES' AND EXISTS(SELECT 1 FROM MarketDrawing m WHERE m.replaySessionId=r.id)
    ORDER BY (SELECT COUNT(*) FROM MarketDrawing m WHERE m.replaySessionId=r.id) DESC LIMIT 1`).get();
  if (!replay) throw new Error("No ES replay session with drawings found");
  dataset = db.prepare("SELECT * FROM MarketDataset WHERE id=?").get(replay.datasetId);
  progress = db.prepare("SELECT currentSequence FROM ReplayProgress WHERE replaySessionId=?").get(replay.id);
  source = db.prepare("SELECT sequence,timestamp,open,high,low,close,volume FROM MarketBar WHERE datasetId=? AND sequence<=? ORDER BY sequence DESC LIMIT 24000")
    .all(dataset.id, progress.currentSequence).reverse().map((bar: MarketBarData) => ({ ...bar, timestamp: new Date(bar.timestamp).toISOString() }));
  drawings = db.prepare("SELECT * FROM MarketDrawing WHERE replaySessionId=? AND type='TREND_LINE' ORDER BY createdAt,id").all(replay.id)
    .map((record: Parameters<typeof serializeMarketDrawing>[0]) => serializeMarketDrawing({ ...record,
      createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) }));
} finally { db.close(); }
const sourceSeconds = datasetSourceInterval(dataset) ?? (() => { throw new Error("Dataset has no supported source interval"); })();
const session = resolveDisplaySession(dataset, "RTH")!;
const aggregated = aggregateMarketBars({ bars: source, sourceSeconds, displaySeconds: 300, session,
  currentSequence: progress.currentSequence, finalSequence: progress.currentSequence });
const revealedHistory = aggregated.slice(-1200);
// Hold back the last already-revealed source candle, then measure its real revision
// or new display bucket. No future source data is needed for the advance sample.
const beforeLastSource = aggregateMarketBars({ bars: source.slice(0, -1), sourceSeconds, displaySeconds: 300, session,
  currentSequence: progress.currentSequence - 1, finalSequence: progress.currentSequence });
const history = beforeLastSource.slice(-1200), live = history.slice(-300);
const style = drawings[0].style;
const primitive = () => {
  const result = new TrendLinePrimitive();
  result.attached({ chart: { timeScale: () => ({ logicalToCoordinate: (index: number) => index * 5, width: () => 1400 }),
    panes: () => [{ getHeight: () => 700 }] }, series: { priceToCoordinate: (price: number) => price }, requestUpdate: () => undefined } as never);
  return result;
};
let conversions = 0;
const original = Intl.DateTimeFormat.prototype.formatToParts;
Intl.DateTimeFormat.prototype.formatToParts = function (...args) { conversions++; return original.apply(this, args); };
function measure(run: () => void) {
  conversions = 0; const started = performance.now(); run();
  return { ms: performance.now() - started, conversions };
}
function median(values: number[]) { return [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)]; }
function scenario(name: string, bars: AggregatedMarketBarData[], lines = drawings) {
  const view = primitive(), timeline = new DrawingTimelineLocator();
  const set = (window: AggregatedMarketBarData[]) => {
    const metadata = drawingTimelineBars(window);
    timeline.setTimeline(metadata, 300, { sourceIntervalSeconds: sourceSeconds, session });
    view.setDrawings({ bars: metadata, timeline, drawings: lines, draftStyle: style, draft: null,
      preview: null, selectedDrawingId: null, displayIntervalSeconds: 300, sourceIntervalSeconds: sourceSeconds, session, priceTickSize: 0.25 });
  };
  const first = measure(() => { set(bars); view.updateAllViews(); });
  const repeated = Array.from({ length: 30 }, () => measure(() => view.updateAllViews()));
  const nextBar = revealedHistory.find(bar => Date.parse(bar.timestamp) > Date.parse(bars.at(-1)!.timestamp));
  const revisedTail = revealedHistory.find(bar => bar.timestamp === bars.at(-1)!.timestamp);
  const next = measure(() => { set(nextBar ? [...bars, nextBar] : [...bars.slice(0, -1), revisedTail ?? bars.at(-1)!]); view.updateAllViews(); });
  const replaced = measure(() => { set(bars.slice(1)); view.updateAllViews(); });
  return { name, residentBars: bars.length, lines: lines.length, timestampOnlyEndpoints: lines.flatMap(line => [line.geometry.start, line.geometry.end]).filter(anchor => anchor.sourceSequence === null).length,
    firstMs: first.ms, firstConversions: first.conversions, repeatedMedianMs: median(repeated.map(item => item.ms)),
    repeatedMaxConversions: Math.max(...repeated.map(item => item.conversions)), nextOperation: nextBar ? "append-revealed-bucket" : "reveal-last-source-candle", nextMs: next.ms, nextConversions: next.conversions,
    windowReplacementMs: replaced.ms, windowReplacementConversions: replaced.conversions };
}
const reports = [];
try {
  reports.push(scenario("live-window", live), scenario("history-window", history),
    // Hiding retains this SAME complete axis; OHLC/volume are masked by ReplayChart.
    scenario("history-hidden-full-axis", history), scenario("hidden-prefix-locator-isolation", history.slice(0, 780)));
  for (const count of [16, 50, 200]) for (const length of [300, 1200]) {
    const lines = Array.from({ length: count }, (_, i) => ({ ...drawings[i % drawings.length], id: "synthetic-" + i,
      geometry: { start: { ...drawings[0].geometry.start, sourceSequence: null,
        timestamp: new Date(Date.parse(history[0].timestamp) - (i + 1) * 86400000).toISOString() },
      end: { ...drawings[0].geometry.end, sourceSequence: null,
        timestamp: new Date(Date.parse(history.at(-1)!.timestamp) + (i + 1) * 86400000).toISOString() } } }));
    reports.push(scenario("synthetic-" + count + "-" + length, history.slice(-length), lines));
  }
} finally { Intl.DateTimeFormat.prototype.formatToParts = original; }
const report = { source: "read-only-local-database", databaseClosedBeforeTiming: true, node: process.version,
  scope: "primitive projection only; no browser canvas, HTTP, or database in timing", reports };
mkdirSync("tmp/trend-line-diagnosis", { recursive: true });
writeFileSync(resolve("tmp/trend-line-diagnosis/projection-after.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
