export type StrategyChecklistItem = { id: string; text: string };
export type TrainingGateMode = "CHECKLIST" | "PLAN";
export const MARKET_CONTEXTS = ["STRONG_BREAKOUT", "WEAK_BREAKOUT", "NARROW_CHANNEL", "WIDE_CHANNEL", "NARROW_RANGE", "WIDE_RANGE"] as const;
export type MarketContext = (typeof MARKET_CONTEXTS)[number];
export type ChecklistEntryDiscipline = {
  mode?: "CHECKLIST";
  strategyId: string;
  strategyName: string;
  checklistVersion: number;
  checklist: StrategyChecklistItem[];
  confirmedAt: string;
};
export type PlanEntryDiscipline = {
  mode: "PLAN";
  context: MarketContext;
  plan: string;
  displayIntervalSeconds: number;
  confirmedSequence: number;
  confirmedAt: string;
};
export type EntryDiscipline = ChecklistEntryDiscipline | PlanEntryDiscipline;
export type TrainingGateState = {
  tradeCount: number;
  autoEnabled: boolean;
  lossThreshold: number;
  nextMode: TrainingGateMode;
  activeMode: TrainingGateMode | null;
  active: boolean;
  targetCount: number;
  completedCount: number;
  lossStreak: number;
  activationCount: number;
  source: "MANUAL" | "LOSS_STREAK" | null;
  activatedAtSequence: number | null;
  cancelledOrderCount: number;
};
export function defaultTrainingGate(): TrainingGateState {
  return { tradeCount: 10, autoEnabled: false, lossThreshold: 2, nextMode: "PLAN", activeMode: null,
    active: false, targetCount: 0, completedCount: 0, lossStreak: 0,
    activationCount: 0, source: null, activatedAtSequence: null, cancelledOrderCount: 0 };
}
export function parseTrainingGate(value?: string | null): TrainingGateState {
  const stored = JSON.parse(value || "{}") as Partial<TrainingGateState>;
  return { ...defaultTrainingGate(), ...stored, activeMode: stored.active ? stored.activeMode ?? "CHECKLIST" : null };
}
export function parseChecklist(value?: string | null): StrategyChecklistItem[] {
  return JSON.parse(value || "[]");
}
export function parseEntryDiscipline(value?: string | null): EntryDiscipline | null {
  return value ? JSON.parse(value) : null;
}
export function isClosingOrder(netQuantity: number, side: "BUY" | "SELL", quantity: number) {
  return Math.abs(netQuantity) > 1e-12 && (netQuantity > 0 ? side === "SELL" : side === "BUY")
    && quantity <= Math.abs(netQuantity) + 1e-12;
}
export function activateTrainingGate(gate: TrainingGateState, source: "MANUAL" | "LOSS_STREAK", sequence: number): TrainingGateState {
  if (gate.active) return { ...gate };
  return { ...gate, active: true, activeMode: gate.nextMode, targetCount: gate.tradeCount, completedCount: 0, lossStreak: 0,
    activationCount: gate.activationCount + 1, source, activatedAtSequence: sequence, cancelledOrderCount: 0 };
}
export function settleGateEntries(gate: TrainingGateState, netResults: number[], sequence: number): TrainingGateState {
  let next = { ...gate };
  for (const pnl of netResults) {
    if (next.active) break;
    if (!next.autoEnabled) { next.lossStreak = 0; continue; }
    next.lossStreak = pnl < -1e-8 ? next.lossStreak + 1 : 0;
    if (next.autoEnabled && next.lossStreak >= next.lossThreshold) next = activateTrainingGate(next, "LOSS_STREAK", sequence);
  }
  return next;
}
export function countGateEntry(gate: TrainingGateState): TrainingGateState {
  if (!gate.active) return gate;
  const completedCount = gate.completedCount + 1;
  return { ...gate, completedCount, active: completedCount < gate.targetCount,
    activeMode: completedCount < gate.targetCount ? gate.activeMode : null, lossStreak: 0 };
}
export function restartTrainingGate(gate: TrainingGateState): TrainingGateState {
  return { ...defaultTrainingGate(), tradeCount: gate.tradeCount, autoEnabled: gate.autoEnabled,
    lossThreshold: gate.lossThreshold, nextMode: gate.nextMode, ...(gate.active ? {
    active: true, activeMode: gate.activeMode, targetCount: gate.tradeCount, source: gate.source, activationCount: gate.activationCount,
  } : {}) };
}
export function disciplineMatchesMode(discipline: EntryDiscipline | null | undefined, mode: TrainingGateMode | null): boolean {
  return Boolean(discipline && (discipline.mode ?? "CHECKLIST") === (mode ?? "CHECKLIST"));
}
export function cancelUncheckedEntries<T extends { status: string; reduceOnly: boolean; isProtective: boolean;
  side: "BUY" | "SELL"; quantity: number; discipline?: EntryDiscipline | null; cancelReason: string | null; id: string }>(
  orders: T[], netQuantity: number, exceptId?: string, mode: TrainingGateMode | null = "CHECKLIST",
) {
  let count = 0;
  for (const order of orders) {
    if (order.id === exceptId || order.status !== "PENDING" || order.isProtective || order.reduceOnly || disciplineMatchesMode(order.discipline, mode)) continue;
    if (isClosingOrder(netQuantity, order.side, order.quantity)) { order.reduceOnly = true; continue; }
    order.status = "CANCELLED"; order.cancelReason = "TRAINING_GATE_REQUIRED"; count += 1;
  }
  return count;
}

export function stableJson(value: unknown): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
  return JSON.stringify(sorted(value));
}
