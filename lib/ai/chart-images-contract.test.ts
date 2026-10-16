import { describe, expect, it } from "vitest";
import { pdfBars, pdfEntry } from "@/lib/paper-trading/pdf-test-fixtures";
import { copy } from "@/lib/i18n";
import { selectChartAnnotations } from "./chart-images-contract";
import { chartAnnotationMapping, chartImageDescription } from "./chart-image-evidence";
import type { ContextChart, ContextEntry, ContextValue } from "./context";

const entry = (no: number, from: number, to: number, extra: Partial<ContextEntry> = {}): ContextEntry => ({
  ...pdfEntry(no, from, to), sourceId: "trade:" + no, logicalKey: "key:" + no, href: "/trade/" + no, reviewOrigin: "USER_OR_LEGACY", ...extra,
});
const current = { id: "current-replay-chart", logicalKey: "current-replay-chart", displayIntervalSeconds: 60, closedAt: "2026-09-08T14:00:00Z" };
const chart = (entryId = current.id): ContextChart => ({ hash: "window", sourceId: "chart:window", entryId, intervalSeconds: 60,
  window: { bars: pdfBars(20).slice(5, 15), warmupBars: [], nextSequence: null, previousSequence: null } });
const context = (entries: ContextEntry[]) => ({ entries, currentChart: current, endSequence: 30 });

describe("frozen AI chart annotations and image descriptions", () => {
  it("includes real trades in a virtual current-chart subject and excludes off-window or future trades", () => {
    const selected = selectChartAnnotations(context([entry(2, 6, 10), entry(5, 0, 8), entry(6, 0, 2), entry(7, 6, 40)]), chart());
    expect(selected.mapping.map((m) => m.displayNo)).toEqual([2, 5]);
    expect(selected.entries.map((e) => e.no)).toEqual([2, 5]); expect(selected.totalTrades).toBe(2);
  });
  it("keeps a single-trade image restricted to that trade", () => {
    const selected = selectChartAnnotations(context([entry(2, 6, 10), entry(5, 8, 12)]), chart("entry-5"));
    expect(selected.mapping).toMatchObject([{ chartNo: 5, displayNo: 5, globalNo: 105 }]);
    expect(selected.entries).toHaveLength(1);
  });
  it("assigns unique image numbers for colliding accounts and keeps every original identity", () => {
    const c = context([entry(1, 6, 10, { globalNo: 40, journalSessionId: "account-a" }), entry(1, 8, 12, { id: "other", globalNo: 70, journalSessionId: "account-b" })]);
    const image = chart(); image.annotations = selectChartAnnotations(c, image);
    expect(image.annotations.entries.map((e) => e.no)).toEqual([1, 2]);
    expect(chartAnnotationMapping(c as ContextValue, [image, image], (e) => "ref:" + e.id)).toEqual([
      { chartNo: 1, displayNo: 1, globalNo: 40, journalAccount: "account-a", tradeRef: "ref:entry-1" },
      { chartNo: 2, displayNo: 1, globalNo: 70, journalAccount: "account-b", tradeRef: "ref:other" },
    ]);
  });
  it("uses the frozen chart cutoff even if the replay has advanced past it", () => {
    const image = chart(), c = { ...context([entry(1, 6, 8), entry(2, 7, 12)]), chartPlans: [{ entryId: current.id, intervalSeconds: 60, fromSequence: 5, endSequence: 10, historyAvailable: 0 }] };
    expect(selectChartAnnotations(c, image).mapping.map((m) => m.displayNo)).toEqual([1]);
  });
  it("does not put an event into a missing source-bar gap", () => {
    const image = chart(); image.window.bars = pdfBars(15).filter((b) => b.firstSequence !== 8 && b.firstSequence !== 10);
    expect(selectChartAnnotations(context([entry(1, 8, 10)]), image).entries).toEqual([]);
  });
  it("reports the existing 100-trade annotation limit without dropping the identity mapping", () => {
    const selected = selectChartAnnotations(context(Array.from({ length: 105 }, (_, i) => entry(i + 1, 6, 10))), chart());
    expect(selected).toMatchObject({ totalTrades: 105, truncated: true });
    expect(selected.entries).toHaveLength(100); expect(selected.mapping).toHaveLength(100);
    expect(selected.mapping[0].displayNo).toBe(6);
  });
  it.each(["COMPLETE", "FORMING", "INCOMPLETE"] as const)("sends the renderer caption as well as annotation coverage (%s)", (status) => {
    const image = chart(); image.window.bars[0].status = status;
    image.annotations = selectChartAnnotations(context([entry(2, 6, 10)]), image);
    expect(chartImageDescription(image)).toMatchObject({ caption: status === "COMPLETE" ? copy.paperTrading.pdf.chartLegend : copy.paperTrading.pdf.incomplete,
      annotationNumbers: [2], annotationCoverage: { verified: true, totalTrades: 1, shownTrades: 1, truncated: false } });
  });
  it("marks old images as unverified and rejects an out-of-scope mapping", () => {
    const image = chart(), c = context([entry(2, 6, 10)]);
    expect(chartImageDescription(image).annotationCoverage.verified).toBe(false);
    image.annotations = selectChartAnnotations(c, image);
    expect(() => chartAnnotationMapping(context([]) as ContextValue, [image], (e) => e.id)).toThrow("ANNOTATION_OUT_OF_SCOPE");
  });
});
