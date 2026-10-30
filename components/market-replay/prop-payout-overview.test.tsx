import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyPayout, defaultPropRules, initialPropState, payoutPreview } from "@/lib/prop-practice/rules";
import type { PropRuntime } from "@/lib/prop-practice/service";
import { PropAccountBadges, PropPayoutReadiness } from "./prop-payout-overview";
import { PropPayoutForm, PropPayoutReceipt } from "./prop-payout-form";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

function funded(profit = 0, days = 0): PropRuntime {
  const rules = structuredClone(defaultPropRules);
  rules.funded.qualifyingDays = 5; rules.funded.qualifyingProfit = 150;
  const state = initialPropState(rules, 0);
  state.phase = "FUNDED"; state.stages[0].kind = "FUNDED";
  state.stages[0].days = Array.from({ length: days }, (_, i) => ({ day: `day${i}`, startRawNet: i * 1000, endRawNet: (i + 1) * 1000, balance: 51000 + i * 1000, traded: true, settled: true }));
  state.last = { sequence: 10, day: `day${Math.max(0, days - 1)}`, rawNet: profit, unrealized: 0, flat: true, pending: 0, hadFill: true };
  return { state, roundNumber: 3, snapshot: { rules, currency: "USDT" } as PropRuntime["snapshot"] };
}
const overview = (runtime: PropRuntime) => renderToStaticMarkup(<PropPayoutReadiness runtime={runtime} preview={payoutPreview(runtime.snapshot.rules, runtime.state)} onViewConditions={() => {}} />);

describe("funded account UI uses the existing payout preview", () => {
  it("shows real thresholds and distinguishes missing days from insufficient funds", () => {
    const pending = funded();
    expect(overview(pending)).toContain("合格盈利日与可提额度尚未达标");
    expect(overview(pending)).toContain("150.00 USDT");
    expect(overview(funded(5000, 4))).toContain("合格盈利日尚未达标");
    expect(overview(funded(0, 5))).toContain("可提上限尚未达到最低申请金额");
    const ready = funded(5000, 5);
    expect(overview(ready)).toContain("可申请出金");
    expect(overview(ready).replace(/<[^>]+>/g, "")).toContain("2,000.00 USDT");
  });
  it("keeps the optional day rule optional and handles large configured day counts", () => {
    const runtime = funded(5000);
    runtime.snapshot.rules.funded.qualifyingDays = null;
    runtime.snapshot.rules.funded.qualifyingProfit = null;
    const html = overview(runtime);
    expect(html).toContain("未开启合格盈利日要求");
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain("可申请出金");
    runtime.snapshot.rules.funded.qualifyingDays = 10000;
    runtime.snapshot.rules.funded.qualifyingProfit = 150;
    expect(overview(runtime)).toContain('aria-valuemax="10000"');
    expect(overview(runtime).length).toBeLessThan(10000);
  });
  it("shows payout-day reset and permits the existing data-end payout behavior", () => {
    const runtime = funded(5000, 5);
    runtime.state.pause = "DATA_END";
    expect(overview(runtime)).toContain("可申请出金");
    runtime.state = applyPayout(runtime.snapshot.rules, runtime.state, 1000).state;
    expect(overview(runtime)).toContain("待恢复交易");
    expect(overview(runtime)).toContain('aria-valuenow="0"');
    expect(overview(runtime)).not.toContain("可申请出金");
  });
  it("does not report an open position or a failed account as ready", () => {
    const runtime = funded(5000, 5);
    runtime.state.last!.flat = false;
    expect(overview(runtime)).toContain("需空仓且无挂单");
    runtime.state.result = "FAILED"; runtime.state.totalReceived = 900;
    expect(overview(runtime)).toContain("本轮已结束");
    const badges = renderToStaticMarkup(<PropAccountBadges runtime={runtime} />);
    expect(badges).toContain("出金失败");
    expect(badges).toContain("成功出金 900.00 USDT");
    const evaluation = funded();
    evaluation.state.phase = "EVALUATION"; evaluation.state.stages[0].kind = "EVALUATION";
    const evaluationBadges = renderToStaticMarkup(<PropAccountBadges runtime={evaluation} />);
    expect(evaluationBadges).toContain("考核阶段");
    expect(evaluationBadges).toContain("bg-blue-50");
    expect(evaluationBadges).not.toContain("出金阶段");
    evaluation.state.result = "FAILED";
    const failedEvaluation = renderToStaticMarkup(<PropAccountBadges runtime={evaluation} />);
    expect(failedEvaluation).toContain("考核未通过");
    expect(failedEvaluation).not.toContain("出金失败");
  });
  it("uses configured amounts and share for application details and confirmation", () => {
    const runtime = funded(5000, 5), preview = payoutPreview(runtime.snapshot.rules, runtime.state);
    const props = { runtime, preview, amount: "1000", received: 900, busy: false, canSubmit: true, onAmountChange: () => {}, onBack: () => {}, onSubmit: () => {} };
    const html = renderToStaticMarkup(<PropPayoutForm {...props} />);
    expect(html).toContain('min="500"'); expect(html).toContain('max="2000"');
    expect(html).toContain("90.00%"); expect(html).toContain("54,000.00 USDT");
    const receipt = renderToStaticMarkup(<PropPayoutReceipt runtime={runtime} preview={preview} amount={1000} received={900} />);
    expect(receipt).toContain("900.00 USDT"); expect(receipt).toContain("100.00 USDT"); expect(receipt).toContain("54,000.00 USDT");
    const blocked = funded();
    expect(renderToStaticMarkup(<PropPayoutForm {...props} runtime={blocked} preview={payoutPreview(blocked.snapshot.rules, blocked.state)} />)).toContain('disabled=""');
  });
});
