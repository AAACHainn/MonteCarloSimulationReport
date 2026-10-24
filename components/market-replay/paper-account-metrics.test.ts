import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PaperAccountMetrics } from "./paper-trading-panel";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";

const snapshot = { session: { realizedPnl: 11189.82, totalFees: 123.45, maxDrawdown: 0.0284, netQuantity: 0, averageEntryPrice: null, currency: "USDT" },
  stats: { unrealizedPnl: 0, balance: 100000, equity: 100000 } } as PaperSessionSnapshot;

// Vitest's JSX transform is classic; Next supplies the automatic JSX runtime.
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("paper account metric display scope", () => {
  it("shows only supplied stage totals after promotion, including zero drawdown", () => {
    const html = renderToStaticMarkup(createElement(PaperAccountMetrics, { snapshot, includeBalances: false, metrics: { realizedPnl: 50, totalFees: 3, maxDrawdown: 0 } }));
    expect(html).not.toContain("11,189.82"); expect(html).not.toContain("123.45"); expect(html).not.toContain("2.84%");
    expect(html).toContain(">50<"); expect(html).toContain(">3<"); expect(html).toContain(">0%<");
  });
  it("retains the original default-account display", () => {
    const html = renderToStaticMarkup(createElement(PaperAccountMetrics, { snapshot }));
    expect(html).toContain("11,189.82"); expect(html).toContain("123.45"); expect(html).toContain("2.84%");
  });
});
