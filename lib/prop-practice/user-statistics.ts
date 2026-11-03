export type RoundSource = {
  replaySessionId: string;
  number: number;
  createdAt: Date;
  endedAt: Date | null;
  state: string;
  account: { replaySession: { name: string; status: string } };
};
export type WalletSource = {
  sessionId: string | null;
  roundNumber: number | null;
  sessionName: string;
  type: string;
  amountMinor: bigint;
  createdAt: Date;
};
export type PassSource = { sessionId: string; roundNumber: number | null; sourceSummary: string };

type Evaluation = "passed" | "notPassed" | "pending";
type Status = "active" | "ended" | "fundedFailed" | "deleted";

export type StatisticsRound = {
  key: string;
  name: string;
  number: number;
  evaluation: Evaluation;
  status: Status;
  purchaseAt: Date | null;
  createdAt: Date | null;
  activationAt: Date | null;
  latestPayoutAt: Date | null;
  purchase: bigint;
  activation: bigint;
  received: bigint;
  payoutCount: number;
};

export function netMinor(round: StatisticsRound) {
  return round.received - round.purchase - round.activation;
}

export function buildUserPropStatistics(rounds: RoundSource[], entries: WalletSource[], passes: PassSource[]) {
  const byRound = new Map<string, StatisticsRound>();
  function getRound(sessionId: string, number: number) {
    const key = JSON.stringify([sessionId, number]);
    const existing = byRound.get(key);
    if (existing) return existing;
    const row: StatisticsRound = {
      key, name: "", number, evaluation: "notPassed", status: "deleted",
      purchaseAt: null, createdAt: null, activationAt: null, latestPayoutAt: null,
      purchase: BigInt(0), activation: BigInt(0), received: BigInt(0), payoutCount: 0,
    };
    byRound.set(key, row);
    return row;
  }

  for (const round of rounds) {
    const row = getRound(round.replaySessionId, round.number);
    const state = JSON.parse(round.state) as { phase?: string; result?: string | null };
    const session = round.account.replaySession;
    const ended = !!(round.endedAt || state.result || session.status === "ARCHIVED");
    row.name = session.name;
    row.createdAt = round.createdAt;
    row.evaluation = state.phase === "FUNDED" ? "passed"
      : state.phase === "EVALUATION" && !ended ? "pending" : "notPassed";
    row.status = state.phase === "FUNDED" && state.result === "FAILED" ? "fundedFailed" : ended ? "ended" : "active";
  }

  // The read query orders wallet rows newest first, so the first retained name is the latest.
  for (const entry of entries) {
    if (!entry.sessionId || !entry.roundNumber) continue;
    const row = getRound(entry.sessionId, entry.roundNumber);
    row.name ||= entry.sessionName;
    switch (entry.type) {
      case "PURCHASE":
        row.purchase -= entry.amountMinor;
        row.purchaseAt = entry.createdAt;
        break;
      case "ACTIVATION":
        row.activation -= entry.amountMinor;
        row.activationAt = entry.createdAt;
        row.evaluation = "passed";
        break;
      case "PAYOUT":
        row.received += entry.amountMinor;
        row.payoutCount++;
        row.evaluation = "passed";
        if (!row.latestPayoutAt || entry.createdAt > row.latestPayoutAt) row.latestPayoutAt = entry.createdAt;
        break;
    }
  }

  for (const pass of passes) {
    if (!pass.roundNumber) continue;
    const row = getRound(pass.sessionId, pass.roundNumber);
    row.evaluation = "passed";
    if (!row.name) {
      const summary = JSON.parse(pass.sourceSummary) as { sessionName?: string } | null;
      row.name = summary?.sessionName ?? "";
    }
  }

  const rows = Array.from(byRound.values()).sort((a, b) =>
    ((b.purchaseAt ?? b.createdAt)?.getTime() ?? -Infinity) - ((a.purchaseAt ?? a.createdAt)?.getTime() ?? -Infinity)
    || b.number - a.number || a.key.localeCompare(b.key));
  const outcomes: Record<Evaluation, number> = { passed: 0, notPassed: 0, pending: 0 };
  const totals = {
    purchase: BigInt(0), activation: BigInt(0), received: BigInt(0), net: BigInt(0),
    payoutRounds: 0, payouts: 0,
  };
  for (const row of rows) {
    outcomes[row.evaluation]++;
    totals.purchase += row.purchase;
    totals.activation += row.activation;
    totals.received += row.received;
    totals.net += netMinor(row);
    totals.payouts += row.payoutCount;
    if (row.payoutCount) totals.payoutRounds++;
  }
  const fees = totals.purchase + totals.activation;
  const feeReturnPercent = fees === BigInt(0) ? null : (Number(totals.net) / Number(fees)) * 100;
  return { rows, outcomes, totals, feeReturnPercent };
}
