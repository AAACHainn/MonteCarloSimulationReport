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
  const session = await tx.paperTradingSession.findUnique({
    where: { datasetId }, select: { journalSessionId: true },
  });
  if (session?.journalSessionId) {
    await tx.replayJournalSession.updateMany({
      where: { id: session.journalSessionId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
  }
  await tx.paperTradingSession.deleteMany({ where: { datasetId } });
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
        sessionId: paperSessionId,
        openedAt: new Date(lot.openedAt),
      })),
    });
  }
  if (!entries.length) return;
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
      journalSessionId,
      no: firstNo + index,
      accountNo: firstAccountNo + index,
      openedAt: new Date(entry.openedAt),
      closedAt: new Date(entry.closedAt),
    })),
  });
}
