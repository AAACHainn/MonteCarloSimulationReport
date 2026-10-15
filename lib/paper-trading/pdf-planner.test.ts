import { describe, expect, it } from "vitest";
import { planPdfCharts, pdfVolumeCount, type PdfWindowReader } from "./pdf-planner";
import { pdfBars, pdfEntry } from "./pdf-test-fixtures";
import { parsePdfDetails, defaultPdfFieldIds, replayFilterSearchParams, describePdfFilters } from "./pdf-settings";
import { createEmptyReplayJournalFilters, readReplayJournalFilters } from "./journal-filters";
import { copy } from "@/lib/i18n";

function reader(count = 1200, stride = 1): PdfWindowReader {
  const bars = pdfBars(count, stride);
  return async (anchor, direction, take) => {
    const i = bars.findIndex((b) => anchor >= b.firstSequence && anchor <= b.lastSequence);
    const selected = i < 0 ? [] : direction === "forward" ? bars.slice(i, i + take) : bars.slice(Math.max(0, i - take + 1), i + 1);
    return { bars: selected, warmupBars: [], previousSequence: selected.length && selected[0].firstSequence > 0 ? selected[0].firstSequence - 1 : null, nextSequence: selected.length && selected.at(-1)!.lastSequence < bars.at(-1)!.lastSequence ? selected.at(-1)!.lastSequence + 1 : null };
  };
}
describe("PDF chart planning", () => {
  it("combines adjacent trades, counts real aggregated candles, and limits density", async () => {
    const entries = Array.from({ length: 7 }, (_, n) => pdfEntry(n + 1, 700 + n * 10, 705 + n * 10));
    const pages = await planPdfCharts(entries, reader(1000, 10));
    expect(pages).toHaveLength(2);
    expect(pages[0].entryIds).toHaveLength(6);
    expect(pages[0].count).toBe(76);
    expect(pages.every((p) => p.count <= 200)).toBe(true);
  });
  it("retains the entire 200-candle trade by removing context", async () => {
    const [page] = await planPdfCharts([pdfEntry(1, 50, 249)], reader());
    expect(page.count).toBe(200); expect(page.beforeCount).toBe(0); expect(page.afterCount).toBe(0);
    expect(page.fromSequence).toBe(50); expect(page.toSequence).toBe(249);
  });
  it("reduces before context first and preserves after context", async () => {
    const [page] = await planPdfCharts([pdfEntry(1, 50, 229)], reader());
    expect(page.count).toBe(200); expect(page.beforeCount).toBe(0); expect(page.afterCount).toBe(20);
  });
  it("splits long positions with 20-candle overlap and continuous coverage", async () => {
    const pages = await planPdfCharts([pdfEntry(1, 60, 570)], reader());
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0].fromSequence).toBe(10);
    for (let i = 1; i < pages.length; i++) expect(pages[i].fromSequence).toBe(pages[i - 1].toSequence - 19);
    expect(pages.at(-1)!.toSequence).toBe(590);
    expect(pages.every((p) => p.entryIds[0] === "entry-1" && p.parts === pages.length && p.count <= 200)).toBe(true);
  });
  it("handles same-candle fills, missing time slots, and dataset edges", async () => {
    const [page] = await planPdfCharts([pdfEntry(1, 0, 0), pdfEntry(2, 0, 0)], reader(8, 10));
    expect(page.count).toBe(8); expect(page.beforeCount).toBe(0); expect(page.afterCount).toBe(7);
  });
  it("refuses missing exit data instead of dropping the trade", async () => {
    await expect(planPdfCharts([pdfEntry(1, 50, 1500)], reader(300))).rejects.toThrow();
  });
  it("creates 100 bounded descriptors without retaining full history", async () => {
    const entries = Array.from({ length: 100 }, (_, n) => pdfEntry(n + 1, 60 + n * 250, 70 + n * 250));
    const pages = await planPdfCharts(entries, reader(26000));
    expect(pages).toHaveLength(100); expect(pdfVolumeCount(pages.length)).toBe(2);
    expect(pdfVolumeCount(50)).toBe(1); expect(pdfVolumeCount(51)).toBe(2);
    expect(pages.every((p) => p.count === 81)).toBe(true);
  });
});
describe("PDF detail and filter settings", () => {
  it("preserves checklist selections in export queries and describes them in Chinese", () => {
    const filters = createEmptyReplayJournalFilters();
    filters.checklistUsed = ["YES", "NO"];
    const params = replayFilterSearchParams(filters);
    expect(params.getAll("checklistUsed")).toEqual(["YES", "NO"]);
    expect(readReplayJournalFilters(params)).toEqual(filters);
    expect(describePdfFilters(filters, [])).toBe(`${copy.paperTrading.checklistUsed}: ${copy.paperTrading.checklistYes}、${copy.paperTrading.checklistNo}`);
  });

  it("keeps empty or disabled detail selections and normalizes order", () => {
    expect(parsePdfDetails(null).detailFieldIds).toEqual(defaultPdfFieldIds);
    expect(parsePdfDetails(JSON.stringify({ includeDetails: false, detailFieldIds: [] }))).toEqual({ includeDetails: false, detailFieldIds: [] });
    expect(parsePdfDetails(JSON.stringify({ includeDetails: true, detailFieldIds: ["review", "no", "bogus", "date", "date"] })).detailFieldIds).toEqual(["date", "review"]);
    expect(parsePdfDetails("{").includeDetails).toBe(true);
  });
  it("serializes all filter kinds without pagination or visible columns", () => {
    const filters = { ...createEmptyReplayJournalFilters(), directions: ["LONG"] as const, setupOptionIds: ["a", "b"], tradeReasonIds: ["x"], results: ["W"] as const, initialRiskAbr: " > 1 " };
    const params = replayFilterSearchParams({ ...filters, directions: [...filters.directions], results: [...filters.results] });
    expect(params.getAll("setupOptionIds")).toEqual(["a", "b"]); expect(params.get("initialRiskAbr")).toBe("> 1"); expect(params.has("page")).toBe(false);
  });
});
