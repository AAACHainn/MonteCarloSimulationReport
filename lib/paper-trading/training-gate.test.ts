import { describe, expect, it } from "vitest";
import { advancePaperTrading } from "./engine";
import { activateTrainingGate, cancelUncheckedEntries, defaultTrainingGate, isClosingOrder, parseTrainingGate, restartTrainingGate, settleGateEntries, type EntryDiscipline } from "./training-gate";
import type { PaperOrderData, PaperSessionState, PaperPositionLotData } from "./types";

const automaticChecklistGate = () => ({ ...defaultTrainingGate(), autoEnabled: true, nextMode: "CHECKLIST" as const });
const discipline: EntryDiscipline = { strategyId: "strategy", strategyName: "趋势", checklistVersion: 1,
  checklist: [{ id: "one", text: "顺势" }], confirmedAt: "2026-10-14T00:00:00.000Z" };
const state = (overrides: Partial<PaperSessionState> = {}): PaperSessionState => ({
  id: "account", datasetId: "market", initialCapital: 10000, currency: "USD", commissionBps: 0, slippageBps: 0,
  lastProcessedSequence: -1, netQuantity: 0, averageEntryPrice: null, realizedPnl: 0, totalFees: 0,
  totalSlippage: 0, peakEquity: 10000, maxDrawdown: 0, version: 1, trainingGate: automaticChecklistGate(), ...overrides,
});
const order = (id: string, overrides: Partial<PaperOrderData> = {}): PaperOrderData => ({
  id, side: "BUY", type: "MARKET", status: "PENDING", quantity: 1, riskAmount: null, price: null,
  stopLoss: null, takeProfit: null, reduceOnly: false, isProtective: false, ocoGroupId: null,
  createdSequence: -1, activeFromSequence: 0, filledSequence: null, filledAt: null, filledPrice: null, cancelReason: null, ...overrides,
});
const bar = (sequence: number, price = 100) => ({ sequence, timestamp: new Date(Date.UTC(2026, 9, 14) + sequence * 60000).toISOString(), open: price, high: price, low: price, close: price, volume: null });
const makeId = (cause?: string) => String(cause);
function run(account: PaperSessionState, orders: PaperOrderData[], price = 100, lots: PaperPositionLotData[] = []) {
  return advancePaperTrading({ state: account, orders, lots, bar: bar(account.lastProcessedSequence + 1, price), makeId });
}
describe("training gate matching", () => {
  it("counts actual opening fills and additions, not pending orders or partial exits", () => {
    const gate = activateTrainingGate({ ...automaticChecklistGate(), tradeCount: 2 }, "MANUAL", -1);
    const first = run(state({ trainingGate: gate }), [order("entry", { discipline, quantity: 2 }), order("pending", { discipline, type: "LIMIT", price: 90 })]);
    expect(first.state.trainingGate).toMatchObject({ active: true, completedCount: 1 });
    const reduced = run(first.state, [order("reduce", { side: "SELL", quantity: 1, reduceOnly: true })], 99, first.lots);
    expect(reduced.state.trainingGate?.completedCount).toBe(1);
    const added = run(reduced.state, [order("add", { discipline })], 100, reduced.lots);
    expect(added.state.trainingGate).toMatchObject({ active: false, completedCount: 2, lossStreak: 0 });
    expect(first.lots[0].remainingQuantity).toBe(2); // inputs remain immutable
  });
  it("settles each FIFO entry once, after its last partial exit, including both fees", () => {
    const first = run(state({ commissionBps: 10 }), [order("entry", { quantity: 2 })]);
    const partial = run(first.state, [order("partial", { side: "SELL", reduceOnly: true })], 90, first.lots);
    expect(partial.state.trainingGate?.lossStreak).toBe(0);
    expect(partial.lots[0].entryNetPnl).toBeCloseTo(-10.29);
    const last = run(partial.state, [order("last", { side: "SELL", reduceOnly: true })], 105, partial.lots);
    expect(last.lots).toEqual([]);
    expect(last.state.trainingGate?.lossStreak).toBe(1);
  });
  it("activates at the second losing entry and cancels unchecked orders within the same bar", () => {
    const first = run(state(), [order("a"), order("b")]);
    const closed = run(first.state, [order("0-close", { side: "SELL", quantity: 2, reduceOnly: true }), order("z-unchecked")], 99, first.lots);
    expect(closed.fills).toHaveLength(1);
    expect(closed.state.trainingGate).toMatchObject({ active: true, source: "LOSS_STREAK", targetCount: 10, completedCount: 0, cancelledOrderCount: 1 });
    expect(closed.orders[1]).toMatchObject({ status: "CANCELLED", cancelReason: "TRAINING_GATE_REQUIRED" });
  });
  it("allows only the close of an unchecked reverse that triggers the second loss", () => {
    const first = run(state(), [order("a"), order("b")]);
    const reversed = run(first.state, [order("reverse", { side: "SELL", quantity: 3 })], 99, first.lots);
    expect(reversed.fills[0]).toMatchObject({ reason: "CLOSE", quantity: 2, openedQuantity: 0 });
    expect(reversed.state.netQuantity).toBe(0);
    expect(reversed.state.trainingGate?.active).toBe(true);
  });
  it("keeps a checked reverse and counts its opening remainder once", () => {
    const first = run(state(), [order("a"), order("b")]);
    const reversed = run(first.state, [order("reverse", { side: "SELL", quantity: 3, discipline })], 99, first.lots);
    expect(reversed.state.netQuantity).toBe(-1);
    expect(reversed.state.trainingGate).toMatchObject({ active: true, completedCount: 1 });
    expect(reversed.lots[0].discipline).toEqual(discipline);
  });
  it.each(["MARKET", "LIMIT", "STOP"] as const)("does not gate a %s reduction and never reverses a reduce-only order", (type) => {
    const first = run(state(), [order("entry", { quantity: 2 })]);
    const reduced = run({ ...first.state, trainingGate: activateTrainingGate(automaticChecklistGate(), "MANUAL", 0) }, [order("exit", { type, side: "SELL", quantity: 99, price: type === "MARKET" ? null : 100, reduceOnly: true })], 100, first.lots);
    expect(reduced.state.netQuantity).toBe(0);
    expect(reduced.state.trainingGate?.completedCount).toBe(0);
    expect(reduced.fills[0].quantity).toBe(2);
  });
  it("preserves each addition's strategy on all partial-close journal records", () => {
    const a = run(state(), [order("a", { discipline, quantity: 2 }), order("b", { discipline: { ...discipline, strategyId: "other" } })]);
    const b = run(a.state, [order("exit", { side: "SELL", quantity: 1, reduceOnly: true })], 110, a.lots);
    const c = run(b.state, [order("rest", { side: "SELL", quantity: 2, reduceOnly: true })], 110, b.lots);
    expect(b.journalEntries[0].discipline).toMatchObject({ strategyId: "strategy" });
    expect(c.journalEntries.map((entry) => entry.discipline)).toMatchObject([{ strategyId: "strategy" }, { strategyId: "other" }]);
  });
  it("does not activate in live replay when no training state is supplied", () => {
    const first = run(state({ trainingGate: null }), [order("a"), order("b")]);
    const last = run(first.state, [order("close", { side: "SELL", quantity: 2 }), order("z-entry")], 90, first.lots);
    expect(last.state.trainingGate).toBeNull();
    expect(last.fills).toHaveLength(2);
  });
});
describe("gate state rules", () => {
  it("defaults unconfigured sessions to manual activation and plan mode", () => {
    const gate = defaultTrainingGate();
    expect(gate).toMatchObject({ autoEnabled: false, nextMode: "PLAN", lossThreshold: 2, tradeCount: 10, active: false });
    expect(parseTrainingGate()).toEqual(gate);
    expect(parseTrainingGate("{}")).toEqual(gate);
    expect(settleGateEntries(gate, [-1, -1, -1], 3)).toMatchObject({ active: false, lossStreak: 0 });
    expect(activateTrainingGate(gate, "MANUAL", 3)).toMatchObject({ active: true, activeMode: "PLAN" });
  });
  it("retains every explicitly saved setting without mutating the stored value", () => {
    const saved = { ...defaultTrainingGate(), autoEnabled: true, nextMode: "CHECKLIST" as const, lossThreshold: 4, tradeCount: 7, lossStreak: 2 };
    const raw = JSON.stringify(saved);
    expect(parseTrainingGate(raw)).toEqual(saved);
    expect(JSON.stringify(saved)).toBe(raw);
  });

  it("retains legacy active checklist mode while filling missing settings with current defaults", () => {
    expect(parseTrainingGate(JSON.stringify({ tradeCount: 7, active: true }))).toMatchObject({
      tradeCount: 7, autoEnabled: false, lossThreshold: 2, nextMode: "PLAN", activeMode: "CHECKLIST",
    });
  });
  it("preserves protective and closing orders when starting", () => {
    const orders = [order("entry"), order("exit", { side: "SELL" }), order("protect", { side: "SELL", isProtective: true }), order("checked", { discipline })];
    expect(cancelUncheckedEntries(orders, 1)).toBe(1);
    expect(orders[1]).toMatchObject({ reduceOnly: true, status: "PENDING" });
    expect(orders[2].status).toBe("PENDING"); expect(orders[3].status).toBe("PENDING");
    expect(isClosingOrder(1, "SELL", 2)).toBe(false);
  });
  it("resets the loss trigger on a win or break-even and never extends an active gate", () => {
    expect(settleGateEntries(automaticChecklistGate(), [-1, 0, -1], 0)).toMatchObject({ active: false, lossStreak: 1 });
    expect(settleGateEntries(automaticChecklistGate(), [-1, 1, -1], 0).active).toBe(false);
    const active = activateTrainingGate(automaticChecklistGate(), "MANUAL", 0);
    expect(settleGateEntries(active, [-1, -1], 1)).toEqual(active);
    expect(activateTrainingGate(active, "MANUAL", 3)).toEqual(active);
  });
  it("keeps an active gate on restart but resets its completed count", () => {
    const active = { ...activateTrainingGate({ ...automaticChecklistGate(), tradeCount: 4, autoEnabled: false,
      lossThreshold: 5, nextMode: "PLAN" }, "MANUAL", 0), completedCount: 3 } as const;
    expect(restartTrainingGate(active)).toMatchObject({ active: true, activeMode: "PLAN", autoEnabled: false,
      lossThreshold: 5, nextMode: "PLAN", targetCount: 4, completedCount: 0, lossStreak: 0 });
  });
  it("uses the configured loss threshold and never triggers while automation is off", () => {
    const disabled = { ...automaticChecklistGate(), autoEnabled: false, lossThreshold: 3, nextMode: "PLAN" as const };
    expect(settleGateEntries(disabled, [-1, -1, -1, -1], 4)).toMatchObject({ active: false, lossStreak: 0 });
    const enabled = { ...disabled, autoEnabled: true };
    expect(settleGateEntries(enabled, [-1, -1], 2)).toMatchObject({ active: false, lossStreak: 2 });
    expect(settleGateEntries(enabled, [-1, -1, -1], 3)).toMatchObject({ active: true, activeMode: "PLAN", source: "LOSS_STREAK" });
  });
  it("cancels pending entries approved for another mode", () => {
    const orders = [order("old-checklist", { discipline }), order("close", { side: "SELL", reduceOnly: true })];
    expect(cancelUncheckedEntries(orders, 1, undefined, "PLAN")).toBe(1);
    expect(orders[0]).toMatchObject({ status: "CANCELLED", cancelReason: "TRAINING_GATE_REQUIRED" });
    expect(orders[1].status).toBe("PENDING");
  });
});
