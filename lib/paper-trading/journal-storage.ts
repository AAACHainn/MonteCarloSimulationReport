import { accountWhere, getReplayScope, storageId } from '@/lib/replay-sessions/scope';
import { archiveReplaySession } from '@/lib/replay-sessions/service';
import type { Prisma } from "@prisma/client";
import { copy } from "@/lib/i18n";
import type { PaperPositionLotData, ReplayJournalEntryDraft } from "./types";

type SessionForJournal = {
  id: string;
  datasetId: string;
  journalSessionId: string | null;
  initialCapital: number;
  currency: string;
  commissionBps: number;
  slippageBps: number;
};

export async function ensureReplayJournalSession(
  tx: Prisma.TransactionClient,
  session: SessionForJournal,
  replayGeneration: number,
) {
  if (session.journalSessionId) return session.journalSessionId;
  const journal = await tx.replayJournalSession.create({
    data: {
      datasetId: session.datasetId,
      replaySessionId: getReplayScope()?.id,
      name: copy.paperTrading.journalSession(replayGeneration),
      replayGeneration,
      initialCapital: session.initialCapital,
      currency: session.currency,
      commissionBps: session.commissionBps,
      slippageBps: session.slippageBps,
    },
  });
  await tx.paperTradingSession.update({ where: { id: session.id }, data: { journalSessionId: journal.id } });
  return journal.id;
}

export async function archiveAndDeletePaperSession(tx: Prisma.TransactionClient, datasetId: string) {
  if (getReplayScope()) return archiveReplaySession(tx);
  const session = await tx.paperTradingSession.findFirst({
    where: accountWhere(datasetId), select: { journalSessionId: true },
  });
  if (session?.journalSessionId) {
    await tx.replayJournalSession.updateMany({
      where: { id: session.journalSessionId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
  }
  await tx.paperTradingSession.deleteMany({ where: accountWhere(datasetId) });
}

export async function persistPaperJournalState(
  tx: Prisma.TransactionClient,
  datasetId: string,
  paperSessionId: string,
  journalSessionId: string,
  lots: PaperPositionLotData[],
  entries: ReplayJournalEntryDraft[],
) {
  await tx.paperPositionLot.deleteMany({ where: { sessionId: paperSessionId } });
  if (lots.length) {
    await tx.paperPositionLot.createMany({
      data: lots.map((lot) => ({
        ...lot,
        id: storageId(lot.id), entryFillId: storageId(lot.entryFillId),
        sessionId: paperSessionId,
        openedAt: new Date(lot.openedAt),
      })),
    });
  }
  if (!entries.length) return;
  const scope = getReplayScope();
  if (scope) {
    const head = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id }, select: { activeProjectionId: true } });
    const known = new Map<string, { no: number; accountNo: number; review: string; setupOptionId: string | null; tradeReasons: { id: string }[] }>();
    for (let offset = 0; offset < entries.length; offset += 500) {
      const keys = entries.slice(offset, offset + 500).map((entry) => entry.id);
      const records = await tx.replayJournalEntry.findMany({
        where: { journalSessionId, logicalKey: { in: keys } },
        include: { tradeReasons: { select: { id: true } } }, orderBy: { createdAt: "asc" },
      });
      for (const record of records) if (record.logicalKey && (!known.has(record.logicalKey) || record.projectionId === head.activeProjectionId)) {
        known.set(record.logicalKey, record);
      }
    }
    const newCount = entries.filter((entry) => !known.has(entry.id)).length;
    let globalNo = 0; let accountNo = 0;
    if (newCount) {
      const dataset = await tx.marketDataset.update({ where: { id: datasetId }, data: { nextReplayJournalNo: { increment: newCount } }, select: { nextReplayJournalNo: true } });
      const journal = await tx.replayJournalSession.update({ where: { id: journalSessionId }, data: { nextEntryNo: { increment: newCount } }, select: { nextEntryNo: true } });
      globalNo = dataset.nextReplayJournalNo - newCount; accountNo = journal.nextEntryNo - newCount;
    }
    for (const entry of entries) {
      const original = known.get(entry.id);
      await tx.replayJournalEntry.create({ data: {
        ...entry, id: storageId(entry.id), lotId: storageId(entry.lotId), logicalKey: entry.id,
        projectionId: scope.projectionId, journalSessionId,
        no: original?.no ?? ++globalNo, accountNo: original?.accountNo ?? ++accountNo,
        openedAt: new Date(entry.openedAt), closedAt: new Date(entry.closedAt),
        review: original?.review ?? "", setupOptionId: original?.setupOptionId ?? null,
        ...(original?.tradeReasons.length ? { tradeReasons: { connect: original.tradeReasons.map(({ id }) => ({ id })) } } : {}),
      } });
    }
    return;
  }
  const dataset = await tx.marketDataset.update({
    where: { id: datasetId },
    data: { nextReplayJournalNo: { increment: entries.length } },
    select: { nextReplayJournalNo: true },
  });
  const journal = await tx.replayJournalSession.update({
    where: { id: journalSessionId },
    data: { nextEntryNo: { increment: entries.length } },
    select: { nextEntryNo: true },
  });
  const firstNo = dataset.nextReplayJournalNo - entries.length + 1;
  const firstAccountNo = journal.nextEntryNo - entries.length + 1;
  await tx.replayJournalEntry.createMany({
    data: entries.map((entry, index) => ({
      ...entry,
      projectionId: getReplayScope()?.projectionId,
      logicalKey: entry.id,
      journalSessionId,
      no: firstNo + index,
      accountNo: firstAccountNo + index,
      openedAt: new Date(entry.openedAt),
      closedAt: new Date(entry.closedAt),
    })),
  });
}
