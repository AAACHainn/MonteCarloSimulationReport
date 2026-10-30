import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultPropRules, initialPropState, payoutPreview } from "@/lib/prop-practice/rules";
import type { PropRuntime } from "@/lib/prop-practice/service";
import { PropPayoutForm } from "./prop-payout-form";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

function funded(profit = 2020, options: {
  days?: number; currency?: string; flat?: boolean; pending?: number; last?: boolean;
  failed?: boolean; floor?: number; minimum?: number; fraction?: number; maximum?: number | null;
  buffer?: number | null; permanentFloorOffset?: number | null;
} = {}): PropRuntime {
  const rules = structuredClone(defaultPropRules);
  rules.payout.minimum = options.minimum ?? 500;
  rules.payout.fraction = options.fraction ?? 0.5;
  rules.payout.maximum = options.maximum === undefined ? 2000 : options.maximum;
  rules.payout.buffer = options.buffer === undefined ? 2100 : options.buffer;
  rules.payout.permanentFloorOffset = options.permanentFloorOffset ?? null;
  rules.funded.qualifyingDays = options.days ?? null;
  rules.funded.qualifyingProfit = 150;
  const state = initialPropState(rules, 0);
  state.phase = "FUNDED";
  state.stages[0].kind = "FUNDED";
  state.stages[0].trailingFloor = options.floor ?? 50020;
  state.stages[0].days = Array.from({ length: 4 }, (_, index) => ({
    day: `day${index}`, startRawNet: index * 1000, endRawNet: index * 1000 + 200,
    balance: 50200 + index * 1000, traded: true, settled: true,
  }));
  state.last = options.last === false ? null : {
    sequence: 10, day: "day3", rawNet: profit, unrealized: 0, flat: options.flat ?? true,
    pending: options.pending ?? 0, hadFill: true,
  };
  if (options.failed) state.result = "FAILED";
  const runtime = { state, roundNumber: 1, snapshot: { rules, currency: options.currency ?? "USD" } as PropRuntime["snapshot"] };
  return runtime;
}
function form(runtime: PropRuntime) {
  const preview = payoutPreview(runtime.snapshot.rules, runtime.state);
  return renderToStaticMarkup(<PropPayoutForm runtime={runtime} preview={preview} amount="500" received={450}
    onAmountChange={() => {}} busy={false} canSubmit={false} onBack={() => {}} onSubmit={() => {}} />);
}

describe("funded payout guidance SSR", () => {
  it("explains the buffer gap from the live balance and associates it with the blocked amount input", () => {
    const html = form(funded(2020));
    expect(html).toContain("\u53d7\u4fdd\u7559\u5229\u6da6\u7f13\u51b2\u9650\u5236");
    expect(html).toContain("US$580.00");
    expect(html).toContain("US$52,020.00");
    expect(html).toContain("US$52,600.00");
    expect(html).toContain("US$52,100.00");
    expect(html).toContain('aria-describedby="prop-payout-range prop-payout-blocked"');
    expect(html).toContain('id="prop-payout-blocked"');
    expect(html).toContain('disabled=""');

    expect(html).not.toContain("USDT");
  });

  it("does not estimate a profit gap or show success when amount rules pass but qualifying days do not", () => {
    const html = form(funded(5200, { days: 5, buffer: null }));
    expect(html).toContain("\u5408\u683c\u76c8\u5229\u65e5\u5c1a\u672a\u8fbe\u6807");
    expect(html).not.toContain("\u8ddd\u6700\u4f4e\u7533\u8bf7\u989d\u8fd8\u9700\u51c0\u5229\u6da6");
    expect(html).not.toContain("\u5f53\u524d\u5df2\u6ee1\u8db3\u7533\u8bf7\u6761\u4ef6");
    expect(html).not.toContain("\u53d7\u4fdd\u7559\u5229\u6da6\u7f13\u51b2\u9650\u5236");
  });

  it("lists position, order, qualification, and every amount limit that blocks the minimum", () => {
    const html = form(funded(1000, {
      days: 5, flat: false, pending: 1, fraction: 0.2, maximum: 400, buffer: 2700, floor: 50600,
    }));
    for (const reason of [
      "\u4ecd\u6709\u672a\u5e73\u4ed3\u6301\u4ed3",
      "\u4ecd\u6709\u5f85\u6210\u4ea4\u6302\u5355",
      "\u5408\u683c\u76c8\u5229\u65e5\u5c1a\u672a\u8fbe\u6807",
      "\u53d7\u53ef\u63d0\u5229\u6da6\u6bd4\u4f8b\u9650\u5236",
      "\u5355\u6b21\u7533\u8bf7\u4e0a\u9650\u4f4e\u4e8e\u6700\u4f4e\u7533\u8bf7\u91d1\u989d",
      "\u53d7\u4fdd\u7559\u5229\u6da6\u7f13\u51b2\u9650\u5236",
      "\u53d7\u51fa\u91d1\u540e\u4e8f\u635f\u5e95\u7ebf\u9650\u5236",
    ]) expect(html).toContain(reason);
    expect(html.match(/\u5f53\u524d\u9650\u5236\u9879/g)).toHaveLength(4);
  });

  it("shows success without a gap or current limiting item when every condition passes", () => {
    const html = form(funded(5200, { days: 4, buffer: null }));
    expect(html).toContain("\u5f53\u524d\u5df2\u6ee1\u8db3\u7533\u8bf7\u6761\u4ef6");
    expect(html).not.toContain("\u8ddd\u6700\u4f4e\u7533\u8bf7\u989d\u8fd8\u9700\u51c0\u5229\u6da6");
    expect(html).not.toContain("\u5f53\u524d\u9650\u5236\u9879");
  });

  it("does not estimate future profit for failed or unobserved accounts", () => {
    expect(form(funded(2020, { failed: true }))).not.toContain("\u8ddd\u6700\u4f4e\u7533\u8bf7\u989d\u8fd8\u9700\u51c0\u5229\u6da6");
    const noObservation = form(funded(2020, { last: false }));
    expect(noObservation).toContain("\u7b49\u5f85\u6709\u6548\u884c\u60c5\u4e0e\u8d26\u6237\u72b6\u6001");
    expect(noObservation).not.toContain("\u8ddd\u6700\u4f4e\u7533\u8bf7\u989d\u8fd8\u9700\u51c0\u5229\u6da6");
  });
});
