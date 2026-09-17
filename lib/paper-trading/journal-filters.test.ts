import { describe, expect, it } from "vitest";
import {
  compileReplayJournalFilters,
  createEmptyReplayJournalFilters,
  hasActiveReplayJournalFilters,
  NO_SETUP_FILTER_VALUE,
  NO_TRADE_REASON_FILTER_VALUE,
  readReplayJournalFilters,
} from "./journal-filters";
import type { ReplayJournalEntryData } from "./types";

function entry(overrides: Partial<ReplayJournalEntryData> = {}): ReplayJournalEntryData {
  return {
    id: "entry-1", lotId: "lot-1", no: 1, globalNo: 1, journalSessionId: "session-1",
    setupOptionId: null, setupOption: null, tradeReasons: [], archivedAt: null,
    direction: "LONG", quantity: 1, openedSequence: 1, openedAt: "2026-01-01T00:00:00.000Z",
    closedSequence: 2, closedAt: "2026-01-01T00:01:00.000Z", entryPrice: 100,
    entryOrderType: "MARKET", exitPrice: 102, initialStopPrice: 99, initialRisk: 1,
    actualRisk: 0.5, gainLoss: 2, abrValue: 2, abrLength: 8, displayIntervalSeconds: 60,
    displaySession: "ETH", displayUtcOffsetMinutes: 0, priceTickSize: 0.01, result: "W",
    initialRiskAbr: 0.5, actualRiskAbr: 0.25, actualInitialRiskRatio: 0.5,
    abrRr: 1, initialRiskRr: 2, actualRiskRr: 4,
    ...overrides,
  };
}

describe("replay journal expression filters", () => {
  it("combines active column expressions with AND semantics", () => {
    const filters = createEmptyReplayJournalFilters();
    filters.initialRiskAbr = "[0.4,0.6]";
    filters.actualRiskRr = "p>3";
    const compiled = compileReplayJournalFilters(filters);

    expect(compiled.error).toBeNull();
    expect(compiled.test(entry())).toBe(true);
    expect(compiled.test(entry({ actualRiskRr: 3 }))).toBe(false);
  });

  it("does not match missing calculated values for an active expression", () => {
    const filters = createEmptyReplayJournalFilters();
    filters.abrRr = "p>=0";

    expect(compileReplayJournalFilters(filters).test(entry({ abrRr: null }))).toBe(false);
  });

  it("reports invalid expressions and detects active filters", () => {
    const filters = createEmptyReplayJournalFilters();
    filters.initialRiskRr = "p>";

    expect(hasActiveReplayJournalFilters(filters)).toBe(true);
    expect(compileReplayJournalFilters(filters).error).toBe("INVALID_EXPRESSION");
  });

  it("combines direction, Setup, trade reason, and result selections", () => {
    const filters = readReplayJournalFilters(new URLSearchParams([
      ["directions", "LONG"],
      ["setupOptionIds", NO_SETUP_FILTER_VALUE],
      ["tradeReasonIds", NO_TRADE_REASON_FILTER_VALUE],
      ["results", "W"],
    ]));
    const compiled = compileReplayJournalFilters(filters);

    expect(compiled.test(entry())).toBe(true);
    expect(compiled.test(entry({ direction: "SHORT" }))).toBe(false);
    expect(compiled.test(entry({ setupOptionId: "setup-1" }))).toBe(false);
    expect(compiled.test(entry({ tradeReasons: [{ id: "reason-1", name: "趋势突破" }] }))).toBe(false);
    expect(compiled.test(entry({ result: "L" }))).toBe(false);
  });

  it("matches any selected trade reason", () => {
    const filters = createEmptyReplayJournalFilters();
    filters.tradeReasonIds = ["reason-2"];
    const compiled = compileReplayJournalFilters(filters);

    expect(compiled.test(entry({ tradeReasons: [{ id: "reason-1", name: "回踩" }, { id: "reason-2", name: "突破" }] }))).toBe(true);
    expect(compiled.test(entry({ tradeReasons: [{ id: "reason-1", name: "回踩" }] }))).toBe(false);
  });
});
