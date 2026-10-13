import { withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { progressWhere, assertReplayWritable, markReplayMutation, getReplayScope } from '@/lib/replay-sessions/scope';
import { NextResponse } from "next/server";
import { prisma, replayDatabaseQueryCount } from "@/lib/db";
import { replayProgressSchema } from "@/lib/validations";
import { copy } from "@/lib/i18n";
import { datasetSourceInterval } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { archiveAndDeletePaperSession } from "@/lib/paper-trading/journal-storage";
import { attachReplayDiagnostics } from "@/lib/market-replay/server-diagnostics";

type RouteContext = { params: Promise<{ id: string }> };

async function handleGET(_request: Request, context: RouteContext) {
  const startedAt = performance.now();
  const queryStart = replayDatabaseQueryCount();
  const { id } = await context.params;
  const transactionStartedAt = performance.now();
  const state = await prisma.$transaction(async (tx) => {
    let progress = await tx.replayProgress.findFirst({ where: progressWhere(id) });
    const snapshot = await getPaperSessionSnapshot(id, tx);
    const scope = getReplayScope();
    const projection = scope ? await tx.replayProjection.findUnique({ where: { id: scope.projectionId } }) : null;
    if (progress && scope?.status === "ARCHIVED" && projection) {
      progress = { ...progress, currentSequence: projection.currentSequence, generation: projection.generation };
    }
    // The account records which source bars were actually processed. Repair stale saves
    // produced by older clients without replaying fills or resetting the account.
    if (progress && snapshot && scope?.status !== "ARCHIVED" && progress.currentSequence !== snapshot.session.lastProcessedSequence) {
      progress = await tx.replayProgress.update({
        where: { id: progress.id }, data: { currentSequence: snapshot.session.lastProcessedSequence },
      });
    }
    return { progress, snapshot, projectionId: scope?.projectionId, sessionVersion: scope?.version };
  });
  return attachReplayDiagnostics(NextResponse.json(state), {
    startedAt,
    queryStart,
    strategy: "authoritative-progress",
    phases: { transaction: performance.now() - transactionStartedAt },
  });
}

async function handlePUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = replayProgressSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? copy.marketReplay.validation.progressInvalid }, { status: 400 });
  }
  const result = await prisma.$transaction(async (tx) => {
    await assertReplayWritable(tx);
    const dataset = await tx.marketDataset.findUnique({ where: { id } });
    if (!dataset) return { error: copy.marketReplay.datasetNotFound, status: 404 } as const;
    const { startSequence, playbackRate, displayIntervalSeconds, displaySession } = parsed.data;
    const sourceSeconds = datasetSourceInterval(dataset);
    if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, displayIntervalSeconds)) {
      return { error: copy.marketReplay.invalidDisplayInterval, status: 400 } as const;
    }
    if (!resolveDisplaySession(dataset, displaySession)) {
      return { error: copy.marketReplay.unsupportedDisplaySession, status: 400 } as const;
    }
    // Advancing and resetting own the cursor. Delayed settings/pagehide requests must
    // never rewind it, even when no paper account exists.
    const updated = await tx.replayProgress.updateMany({
      where: { ...progressWhere(id), startSequence },
      data: { playbackRate, displayIntervalSeconds, displaySession },
    });
    if (!updated.count) return { error: copy.paperTrading.conflict, status: 409 } as const;
    const progress = await tx.replayProgress.findFirstOrThrow({ where: progressWhere(id) });
    await markReplayMutation(tx);
    return { progress, error: null, status: 200 } as const;
  });
  return NextResponse.json(result.error ? { error: result.error } : result.progress, { status: result.status });
}

async function handleDELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await prisma.$transaction(async (tx) => {
    await archiveAndDeletePaperSession(tx, id);
  });
  return NextResponse.json({ ok: true });
}

export const GET = withReplaySessionRoute(handleGET, { write: false, annotation: false });

export const PUT = withReplaySessionRoute(handlePUT, { write: true, annotation: false });

export const DELETE = withReplaySessionRoute(handleDELETE, { write: true, annotation: false, allowHistoryChange: true });
