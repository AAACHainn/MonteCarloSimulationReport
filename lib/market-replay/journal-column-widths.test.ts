import { describe, expect, it } from "vitest";
import {
  MAX_JOURNAL_COLUMN_WIDTH,
  MIN_JOURNAL_COLUMN_WIDTH,
  clampJournalColumnWidth,
  normalizeJournalTableWidth,
  parseStoredJournalColumnWidths,
  parseStoredJournalTableOffset,
  parseStoredJournalTableWidth,
  resizeJournalTableFromStartEdge,
} from "./journal-column-widths";

describe("replay journal column widths", () => {
  it("rounds widths and keeps them inside the supported range", () => {
    expect(clampJournalColumnWidth(132.6)).toBe(133);
    expect(clampJournalColumnWidth(20)).toBe(MIN_JOURNAL_COLUMN_WIDTH);
    expect(clampJournalColumnWidth(900)).toBe(MAX_JOURNAL_COLUMN_WIDTH);
  });

  it("loads only finite widths for known columns", () => {
    const defaults = { no: 72, date: 120 };
    expect(parseStoredJournalColumnWidths(
      JSON.stringify({ no: 98.4, date: Number.POSITIVE_INFINITY, unknown: 400 }),
      defaults,
    )).toEqual({ no: 98, date: 120 });
  });

  it("falls back to defaults for invalid saved preferences", () => {
    const defaults = { no: 72, date: 120 };
    expect(parseStoredJournalColumnWidths("not-json", defaults)).toEqual(defaults);
    expect(parseStoredJournalColumnWidths("[]", defaults)).toEqual(defaults);
  });

  it("keeps the overall table width unbounded while rejecting invalid preferences", () => {
    expect(normalizeJournalTableWidth(12_345.6)).toBe(12_346);
    expect(parseStoredJournalTableWidth("12345.6")).toBe(12_346);
    expect(parseStoredJournalTableWidth("invalid")).toBeNull();
    expect(parseStoredJournalTableWidth("-100")).toBeNull();
  });

  it("parses a signed table offset", () => {
    expect(parseStoredJournalTableOffset("-128.4")).toBe(-128);
    expect(parseStoredJournalTableOffset("not-a-number")).toBe(0);
    expect(parseStoredJournalTableOffset(null)).toBe(0);
  });

  it("resizes from the left edge while keeping the right edge fixed", () => {
    expect(resizeJournalTableFromStartEdge({
      startWidth: 1_800,
      startOffset: 0,
      pointerDelta: -120,
      minimumWidth: 1_600,
    })).toEqual({ width: 1_920, offset: -120 });

    expect(resizeJournalTableFromStartEdge({
      startWidth: 1_920,
      startOffset: -120,
      pointerDelta: 500,
      minimumWidth: 1_600,
    })).toEqual({ width: 1_600, offset: 200 });
  });
});
