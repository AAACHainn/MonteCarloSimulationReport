import type { Prisma, PaperTradingSession } from "@prisma/client";
import { flatEquityPoint } from "./flat-advance";
import { serializePaperSession } from "./serialize";

/** Persist an external cash adjustment without changing trading facts or return metrics. */
export async function setAccountCashAdjustment(tx: Prisma.TransactionClient, original: PaperTradingSession, cashAdjustment: number) {
  const account = await tx.paperTradingSession.update({ where: { id: original.id }, data: { cashAdjustment, version: { increment: 1 } } });
  const bar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: account.datasetId, sequence: account.lastProcessedSequence } } });
  if (bar) {
    const point = flatEquityPoint(serializePaperSession(account), bar.sequence, bar.timestamp.toISOString());
    const data = { ...point, timestamp: new Date(point.timestamp) };
    await tx.paperEquityPoint.upsert({ where: { sessionId_sequence: { sessionId: account.id, sequence: bar.sequence } }, create: { ...data, sessionId: account.id }, update: data });
  }
  return account;
}
