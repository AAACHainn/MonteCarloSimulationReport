import { describe, expect, it } from "vitest";
import type { ReplayTradeAnnotationData } from "@/lib/paper-trading/types";
import {
  buildReplayTradePriceAnnotations,
  replayTradeActualRiskPrice,
  replayTradeAnnotationColor,
  replayTradeOrderTypeAbbreviation,
  REPLAY_TRADE_ANNOTATION_COLORS,
} from "./trade-annotation-primitive";

function entry(values: Partial<ReplayTradeAnnotationData> = {}): ReplayTradeAnnotationData {
  return {
    id: "trade-1",
    no: 1,
    direction: "LONG",
    entryOrderType: "LIMIT",
    openedSequence: 10,
    closedSequence: 20,
    entryPrice: 100,
    initialStopPrice: 95,
    actualRisk: 3,
    exitPrice: 108,
    result: "W",
    ...values,
  };
}

describe("replay trade price annotations", () => {
  it("cycles a deterministic five-color palette by journal number", () => {
    expect(Array.from({ length: 6 }, (_, index) => replayTradeAnnotationColor(index + 1))).toEqual([
      ...REPLAY_TRADE_ANNOTATION_COLORS,
      REPLAY_TRADE_ANNOTATION_COLORS[0],
    ]);
  });

  it("uses compact entry order abbreviations and an honest legacy fallback", () => {
    expect(["LIMIT", "STOP", "MARKET", null].map((type) => (
      replayTradeOrderTypeAbbreviation(type as ReplayTradeAnnotationData["entryOrderType"])
    ))).toEqual(["LMT", "STP", "MKT", "?"]);
  });

  it("projects actual adverse risk below long entries and above short entries", () => {
    expect(replayTradeActualRiskPrice(entry())).toBe(97);
    expect(replayTradeActualRiskPrice(entry({ direction: "SHORT" }))).toBe(103);
  });

  it("builds entry, iRisk, aRisk, and outcome labels at their event sequences", () => {
    const annotations = buildReplayTradePriceAnnotations(entry({ no: 2, entryOrderType: "STOP", result: "L" }));
    expect(annotations.map((annotation) => ({ sequence: annotation.sequence, price: annotation.price, label: annotation.label }))).toEqual([
      { sequence: 10, price: 100, label: "2) STP B" },
      { sequence: 10, price: 95, label: "2) iRisk" },
      { sequence: 10, price: 97, label: "2) aRisk" },
      { sequence: 20, price: 108, label: "2) SL" },
    ]);
  });

  it("omits iRisk without an initial stop and maps flat exits to BE", () => {
    const annotations = buildReplayTradePriceAnnotations(entry({
      direction: "SHORT",
      entryOrderType: null,
      initialStopPrice: null,
      actualRisk: 0,
      result: "BE",
    }));
    expect(annotations.map((annotation) => annotation.label)).toEqual([
      "1) ? S",
      "1) aRisk",
      "1) BE",
    ]);
  });
});
