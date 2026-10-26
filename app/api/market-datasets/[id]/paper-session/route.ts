import { sqliteErrorResponse } from "@/lib/sqlite-write-response";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { progressWhere, getReplayScope, assertReplayWritable, markReplayMutation, storageId, runWithReplayScope, ReplaySessionError } from '@/lib/replay-sessions/scope';
import { initializePropPracticeAccount, recordReplayCommand } from '@/lib/replay-sessions/service';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { paperSessionSchema } from "@/lib/validations";
import { createPaperAccountSchema } from "@/lib/prop-practice/account-input";
import { archiveAndDeletePaperSession } from "@/lib/paper-trading/journal-storage";
import { fundStandardAccount } from "@/lib/user-wallet/service";

type RouteContext = { params: Promise<{ id: string }> };

async function handleGET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id), projectionId: getReplayScope()?.projectionId });
}

async function handlePOST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = createPaperAccountSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  let created = false;
  const scope = getReplayScope();
  const isProp = parsed.data.accountCategory === "PROP_PRACTICE";
  try {
    created = await sqliteWriteTransaction(prisma, async (tx) => {
      await assertReplayWritable(tx);
      if (parsed.data.accountCategory === "PROP_PRACTICE") {
        await initializePropPracticeAccount(tx, parsed.data.propTemplateVersionId, parsed.data);
        await markReplayMutation(tx);
        return true;
      }
      if (scope?.accountCategory === "PROP_PRACTICE") throw new ReplaySessionError("ACCOUNT_EXISTS", 409, copy.propPractice.accountFixed);
      const config = paperSessionSchema.parse(parsed.data);
      const [progress, dataset] = await Promise.all([
        tx.replayProgress.findFirst({ where: progressWhere(id), select: { currentSequence: true, generation: true } }),
        tx.marketDataset.findUnique({ where: { id }, select: { barCount: true } }),
      ]);
      if (!progress || !dataset) return false;
      const owner = scope ? await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id }, }) : null;
      const journalData = {
          datasetId: id,
          replaySessionId: getReplayScope()?.id,
          name: owner?.name ?? copy.paperTrading.journalSession(progress.generation),
          replayGeneration: progress.generation,
          ...config,
      };
      const journal = scope ? await tx.replayJournalSession.upsert({
        where: { replaySessionId: scope.id }, create: journalData, update: { ...config, archivedAt: null },
      }) : await tx.replayJournalSession.create({ data: journalData });
      await tx.paperTradingSession.create({
        data: {
          ...(scope ? { id: storageId(`account_${scope.id}`) } : {}),
          datasetId: id,
          projectionId: getReplayScope()?.projectionId,
          journalSessionId: journal.id,
          ...config,
          lastProcessedSequence: progress.currentSequence,
          peakEquity: config.initialCapital,
          equitySampleStride: Math.max(1, Math.ceil(dataset.barCount / 20_000)),
        },
      });
      if (scope && owner) await fundStandardAccount(tx, owner, scope.projectionId, config.initialCapital);
      await recordReplayCommand(tx, progress.currentSequence, "ACCOUNT_INIT", {
        ...config, logicalAccountId: scope ? `account_${scope.id}` : undefined,
        equitySampleStride: Math.max(1, Math.ceil(dataset.barCount / 20_000)),
      });
      await markReplayMutation(tx);
      return true;
    });
  } catch (error) {
    const busy = sqliteErrorResponse(error); if (busy) return busy;
    if (error instanceof ReplaySessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: copy.paperTrading.requestFailed }, { status: 409 });
  }
  if (!created) return NextResponse.json({ error: copy.marketReplay.validation.progressInvalid }, { status: 400 });
  const snapshot = scope && isProp
    ? await runWithReplayScope({ ...scope, accountCategory: "PROP_PRACTICE" }, () => getPaperSessionSnapshot(id))
    : await getPaperSessionSnapshot(id);
  return NextResponse.json({ snapshot }, { status: 201 });
}

async function handleDELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await sqliteWriteTransaction(prisma, (tx) => archiveAndDeletePaperSession(tx, id));
  return NextResponse.json({ ok: true });
}

export const GET = withReplaySessionRoute(handleGET, { write: false, annotation: false });

export const POST = withReplaySessionRoute(handlePOST, { write: true, annotation: false });

export const DELETE = withReplaySessionRoute(handleDELETE, { write: true, annotation: false, allowHistoryChange: true });
