import { hashValue, type ContextValue } from "./context";
import { executeReadTool, sourceReceipt, tradeRef, type Receipt, type ToolScope } from "./tools";
export type CoverageBatch = { entryKeys: string[]; reviewedKeys: string[]; chartHashes: string[]; imageHashes: string[]; receipts: Receipt[]; inputHash: string };
export function programBatch(scope: ToolScope, entries: ContextValue["entries"], charts: ContextValue["charts"], imageHashes: string[], signal: AbortSignal) {
  const receipts: Receipt[] = [];
  const records = entries.map((e) => {
    const result = executeReadTool(scope, "get_trade_record", { tradeRef: tradeRef(scope, e), sections: ["facts", "review", "discipline"], cursor: null, limit: null }, signal);
    if (!result.ok) throw new Error("PROGRAM_EVIDENCE_UNAVAILABLE");
    receipts.push(...result.sources.map((r) => ({ ...r, readVia: "PROGRAM_BATCH" as const })));
    return { ...result.data, sources: result.sources.map((r) => r.sourceRef) };
  });
  const chartData = charts.map((chart) => {
    const data = { variantRef: chart.variantRef, intervalSeconds: chart.intervalSeconds ?? scope.context.display.displayIntervalSeconds, windowHash: chart.hash, bars: chart.window.bars,
      imageAttached: imageHashes.includes(chart.hash), endSequence: chart.window.bars.at(-1)?.lastSequence };
    receipts.push({ ...sourceReceipt(scope, chart.sourceId, "CHART_DATA", ["bars"], data, "PROGRAM_BATCH"), variantRef: chart.variantRef, imageAttached: false });
    if (data.imageAttached) receipts.push({ ...sourceReceipt(scope, chart.sourceId, "CHART_IMAGE", ["image"], chart.hash, "PROGRAM_BATCH"), variantRef: chart.variantRef, imageAttached: true });
    return { ...data, sources: receipts.filter((r) => r.resourceRef === chart.sourceId).map((r) => r.sourceRef) };
  });
  const selectedTemplate = scope.context.template ? executeReadTool(scope, "get_review_template", {}, signal) : null;
  const template = selectedTemplate ? { ...selectedTemplate, sources: selectedTemplate.sources.map((r) => ({ ...r, readVia: "PROGRAM_BATCH" as const })) } : null;
  if (template) receipts.push(...template.sources);
  const payload = { records, charts: chartData, ...(template ? { template } : {}) };
  const coverage: CoverageBatch = { entryKeys: entries.map((e) => e.logicalKey), reviewedKeys: entries.filter((e) => e.review.trim()).map((e) => e.logicalKey), chartHashes: charts.map((ch) => ch.hash), imageHashes, receipts, inputHash: hashValue(payload) };
  return { payload, coverage };
}
export function coverageLedger(context: ContextValue, completed: CoverageBatch[]) {
  const keys = new Set(completed.flatMap((b) => b.entryKeys)), reviewed = new Set(completed.flatMap((b) => b.reviewedKeys)), images = new Set(completed.flatMap((b) => b.imageHashes));
  return { expectedRows: context.entries.length, factRows: context.entries.filter((e) => keys.has(e.logicalKey)).length,
    reviewedRows: context.entries.filter((e) => reviewed.has(e.logicalKey)).length, emptyReviewRows: context.entries.filter((e) => !e.review.trim()).length,
    expectedCharts: context.charts.length, readImages: context.charts.filter((ch) => images.has(ch.hash)).length, missingImages: context.charts.filter((ch) => !images.has(ch.hash)).length,
    complete: context.entries.every((e) => keys.has(e.logicalKey)) && (context.depth !== "full" || context.charts.every((ch) => images.has(ch.hash))),
    mode: context.depth, note: context.depth === "quick" ? "NO_CLAIM_OF_FULL_CHART_REVIEW" : "ALL_PREPARED_WINDOWS_REQUIRED" };
}
