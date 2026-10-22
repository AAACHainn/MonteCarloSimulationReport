import { sqliteErrorResponse } from "@/lib/sqlite-write-response";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { progressWhere, getReplayScope, assertReplayWritable, markReplayMutation, storageId } from '@/lib/replay-sessions/scope';
import { recordReplayCommand } from '@/lib/replay-sessions/service';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { paperSessionSchema } from "@/lib/validations";
import { archiveAndDeletePaperSession } from "@/lib/paper-trading/journal-storage";

type RouteContext = { params: Promise<{ id: string }> };

async function handleGET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id), projectionId: getReplayScope()?.projectionId });
}

async function handlePOST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = paperSessionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  let created = false;
  try {
    created = await sqliteWriteTransaction(prisma, async (tx) => {
      await assertReplayWritable(tx);
      const [progress, dataset] = await Promise.all([
        tx.replayProgress.findFirst({ where: progressWhere(id), select: { currentSequence: true, generation: true } }),
        tx.marketDataset.findUnique({ where: { id }, select: { barCount: true } }),
      ]);
      if (!progress || !dataset) return false;
      const scope = getReplayScope();
      const owner = scope ? await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id }, select: { name: true } }) : null;
      const journalData = {
          datasetId: id,
          replaySessionId: getReplayScope()?.id,
          name: owner?.name ?? copy.paperTrading.journalSession(progress.generation),
          replayGeneration: progress.generation,
          ...parsed.data,
      };
      const journal = scope ? await tx.replayJournalSession.upsert({
        where: { replaySessionId: scope.id }, create: journalData, update: { ...parsed.data, archivedAt: null },
      }) : await tx.replayJournalSession.create({ data: journalData });
      await tx.paperTradingSession.create({
        data: {
          ...(scope ? { id: storageId(`account_${scope.id}`) } : {}),
          datasetId: id,
          projectionId: getReplayScope()?.projectionId,
          journalSessionId: journal.id,
          ...parsed.data,
          lastProcessedSequence: progress.currentSequence,
          peakEquity: parsed.data.initialCapital,
          equitySampleStride: Math.max(1, Math.ceil(dataset.barCount / 20_000)),
        },
      });
      await recordReplayCommand(tx, progress.currentSequence, "ACCOUNT_INIT", {
        ...parsed.data, logicalAccountId: scope ? `account_${scope.id}` : undefined,
        equitySampleStride: Math.max(1, Math.ceil(dataset.barCount / 20_000)),
      });
      await markReplayMutation(tx);
      return true;
    });
  } catch (error) {
    const busy = sqliteErrorResponse(error); if (busy) return busy;
    return NextResponse.json({ error: copy.paperTrading.requestFailed }, { status: 409 });
  }
  if (!created) return NextResponse.json({ error: copy.marketReplay.validation.progressInvalid }, { status: 400 });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) }, { status: 201 });
}

async function handleDELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await sqliteWriteTransaction(prisma, (tx) => archiveAndDeletePaperSession(tx, id));
  return NextResponse.json({ ok: true });
}

export const GET = withReplaySessionRoute(handleGET, { write: false, annotation: false });

export const POST = withReplaySessionRoute(handlePOST, { write: true, annotation: false });

export const DELETE = withReplaySessionRoute(handleDELETE, { write: true, annotation: false, allowHistoryChange: true });
