import { stableJson } from "./training-gate";
import type { Prisma } from "@prisma/client";
import type { PaperReplayDelta } from "@/lib/market-replay/client-sync";
import type { PaperOrderData, PaperSessionState } from "./types";
import { advancePaperTrading } from "./engine";
import { createDeterministicEventIdFactory } from "./deterministic-id";
import { hydrateTrainingLots, serializePaperPositionLot } from "./serialize";
import { serializeSourceBar } from "@/lib/market-replay/dataset";
import { paperStateFingerprint } from "./speculative";

/** Validate discipline against server-owned orders and replay actual source bars.
 * The browser cannot fabricate approval snapshots, counters or lot outcomes. */
export async function validateTrainingDelta(db: Prisma.TransactionClient, accountId: string, generation: number,
  start: PaperSessionState, initialOrders: PaperOrderData[], delta: PaperReplayDelta) {
  await hydrateTrainingLots(db, accountId);
  let lots = (await db.paperPositionLot.findMany({ where: { sessionId: accountId }, orderBy: [{ openedSequence: "asc" }, { createdAt: "asc" }] })).map(serializePaperPositionLot);
  if (!lots.length && !initialOrders.length && !delta.fills.length && !delta.orderChanges.length && !delta.openLots.length && !delta.journalEntries.length) {
    return stableJson(start.trainingGate) === stableJson(delta.state.trainingGate);
  }
  let state = start;
  let orders = initialOrders;
  const fills = [], entries = [];
  const changed = new Map<string, PaperOrderData>();
  const originals = new Map(orders.map((order) => [order.id, JSON.stringify(order)]));
  const contexts = delta.contextRuns ?? [];
  let contextIndex = 0;
  // Bound the read even for the maximum sync window.
  for (let from = start.lastProcessedSequence + 1; from <= delta.state.lastProcessedSequence; from += 4096) {
    const bars = await db.marketBar.findMany({ where: { datasetId: start.datasetId, sequence: { gte: from, lte: Math.min(from + 4095, delta.state.lastProcessedSequence) } }, orderBy: { sequence: "asc" } });
    for (const record of bars) {
      while (contexts[contextIndex] && contexts[contextIndex].toSequence < record.sequence) contextIndex++;
      const result = advancePaperTrading({ state, orders, lots, bar: serializeSourceBar(record),
        journalContext: contexts[contextIndex]?.context ?? null,
        makeId: createDeterministicEventIdFactory(state.id, generation, record.sequence) });
      state = result.state; lots = result.lots;
      for (const order of result.orders) if (originals.get(order.id) !== JSON.stringify(order)) changed.set(order.id, order);
      orders = result.orders.filter((order) => order.status === "PENDING");
      fills.push(...result.fills); entries.push(...result.journalEntries);
    }
  }
  const normalize = <T extends { id: string }>(items: T[]) => stableJson([...items].sort((a, b) => a.id.localeCompare(b.id)));
  const economicOrder = (order: PaperOrderData) => { const { createdAt: _createdAt, ...rest } = order; void _createdAt; return rest; };
  return paperStateFingerprint(state, orders, lots) === delta.fingerprint
    && normalize(fills) === normalize(delta.fills)
    && normalize(entries) === normalize(delta.journalEntries)
    && normalize([...changed.values()].map(economicOrder)) === normalize(delta.orderChanges.map(economicOrder));
}
