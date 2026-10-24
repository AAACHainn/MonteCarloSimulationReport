import { describe, expect, it } from "vitest";
import { initialStageMetrics, observeStageMetrics, replayMetricClose } from "./stage-metrics";
import { applyPayout, currentStage, defaultPropRules, initialPropState, observeProp, promotePropManually, settlePropDay, type Observation } from "./rules";

function rules() {
  const r = structuredClone(defaultPropRules);
  r.evaluation.risk = { initialCapital: 1000, drawdown: 900, mode: "STATIC", capOffset: null };
  r.funded.risk = { initialCapital: 2000, drawdown: 1500, mode: "STATIC", capOffset: null };
  r.evaluation.target = 100; r.evaluation.minTradingDays = null; r.evaluation.consistency = null;
  r.payout = { minimum: 1, maximum: null, fraction: 1, buffer: null, traderShare: 0.9, permanentFloorOffset: null };
  return r;
}
const observation = (more: Partial<Observation> = {}): Observation => ({ sequence: 1, day: "2026-10-01T00:00:00Z", rawNet: 110, realizedPnl: 120, totalFees: 10,
  unrealized: 0, flat: true, pending: 0, hadFill: true, ...more });

describe("current prop-stage display statistics", () => {
  it.each(["manual", "automatic"])("starts fresh at %s promotion without changing evaluation history or observations", mode => {
    const r = rules();
    let before = observeProp(r, initialPropState(r, 0), observation());
    before = observeProp(r, before, observation({ sequence: 2, rawNet: 100, realizedPnl: 112, totalFees: 12 }));
    const evaluation = structuredClone(currentStage(before));
    expect(evaluation.metrics).toMatchObject({ realizedPnl: 112, totalFees: 12 });
    expect(evaluation.metrics!.maxDrawdown).toBeGreaterThan(0);
    const after = mode === "manual" ? promotePropManually(r, before) : settlePropDay(r, before);
    expect(after.phase).toBe("FUNDED");
    expect(currentStage(after).metrics).toEqual(initialStageMetrics(2000, 112, 12));
    expect(after.last).toEqual(before.last);
    expect(before.stages).toEqual([evaluation]);
    const traded = observeProp(r, { ...after, pause: "NONE" }, observation({ sequence: 3, rawNet: 195, realizedPnl: 212, totalFees: 17 }));
    expect(currentStage(traded).metrics).toMatchObject({ realizedPnl: 100, totalFees: 5, peakEquity: 2095, maxDrawdown: 0 });
    expect(after.stages[0]).toEqual(traded.stages[0]);
    const drawdown = observeProp(r, traded, observation({ sequence: 4, rawNet: 195, realizedPnl: 212, totalFees: 17, unrealized: -200, flat: false }));
    expect(currentStage(drawdown).metrics!.maxDrawdown).toBeCloseTo(200 / 2095);
  });

  it("keeps paid-out money out of trading drawdown and does not reset statistics on payout", () => {
    const r = rules(), before = promotePropManually(r, observeProp(r, initialPropState(r, 0), observation()));
    const funded = observeProp(r, before, observation({ sequence: 2, rawNet: 310, realizedPnl: 330, totalFees: 20 }));
    const paid = applyPayout(r, funded, 100).state;
    expect(currentStage(paid).metrics).toEqual(currentStage(funded).metrics);
    const next = observeProp(r, paid, observation({ sequence: 3, rawNet: 310, realizedPnl: 330, totalFees: 20, hadFill: false }));
    expect(currentStage(next).metrics).toEqual(currentStage(funded).metrics);
  });

  it("keeps the largest historical drawdown after equity recovers, including fees and floating loss", () => {
    const initial = initialStageMetrics(100000);
    const peak = observeStageMetrics(initial, 10000, 0, 110000);
    const loss = observeStageMetrics(peak, 5000, 0, 105000);
    expect(loss.maxDrawdown).toBeCloseTo(5000 / 110000);
    expect(observeStageMetrics(loss, 10000, 0, 110000).maxDrawdown).toBe(loss.maxDrawdown);
    expect(initial).toEqual(initialStageMetrics(100000));
  });

  it("reconstructs source-close peaks and same-candle current-price close loss from original fills", () => {
    let replay = { metrics: initialStageMetrics(1000), cash: 0, quantity: 0 };
    replay = replayMetricClose(replay, 1000, 110, [{ side: "BUY", price: 100, quantity: 10, fee: 2, realizedPnl: 0, immediate: false }]);
    expect(replay.metrics.peakEquity).toBe(1098);
    replay = replayMetricClose(replay, 1000, 90, [{ side: "SELL", price: 89, quantity: 10, fee: 2, realizedPnl: -110, immediate: true }]);
    expect(replay.metrics).toMatchObject({ realizedPnl: -110, totalFees: 4, peakEquity: 1098 });
    expect(replay.metrics.maxDrawdown).toBeCloseTo((1098 - 886) / 1098);
  });

  it("does not observe intermediate intrabar fills as separate equity peaks", () => {
    const replay = replayMetricClose({ metrics: initialStageMetrics(1000), cash: 0, quantity: 0 }, 1000, 100, [
      { side: "BUY", price: 90, quantity: 1, fee: 1, realizedPnl: 0, immediate: false },
      { side: "SELL", price: 95, quantity: 1, fee: 1, realizedPnl: 5, immediate: false },
    ]);
    expect(replay.metrics).toMatchObject({ realizedPnl: 5, totalFees: 2, peakEquity: 1003, maxDrawdown: 0 });
  });
});
