import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { withReplaySessionRoute, journalScopeWhere, entryProjectionWhere, getReplayScope } from '@/lib/replay-sessions/scope';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeReplayJournalEntry } from "@/lib/paper-trading/journal";
import { withReplayJournalDisplayNumbers } from "@/lib/paper-trading/journal-numbering";
import { replayJournalEntryUpdateSchema } from "@/lib/validations";
import { AiError } from "@/lib/ai/errors";
import { readContext } from "@/lib/ai/context";
import { logicalId } from "@/lib/replay-sessions/identity";
import { reviewFactsHash } from "@/lib/ai/review-baseline";
import type { ContextValue } from "@/lib/ai/context";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

async function handlePATCH(request: Request, context: RouteContext) {
  const { id, entryId } = await context.params;
  const parsed = replayJournalEntryUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: copy.paperTrading.journalEntryUpdateInvalid }, { status: 400 });
  }

  const entry = await prisma.replayJournalEntry.findFirst({
    where: { id: entryId, ...entryProjectionWhere(), journalSession: { datasetId: id, ...journalScopeWhere() } },
    select: { id: true, logicalKey: true, review: true, projectionId: true },
  });
  if (!entry) {
    return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });
  }

  if (parsed.data.setupOptionId) {
    const setupOption = await prisma.tradeOption.findFirst({
      where: { id: parsed.data.setupOptionId, type: "STRATEGY", active: true },
      select: { id: true },
    });
    if (!setupOption) {
      return NextResponse.json({ error: copy.paperTrading.setupInvalid }, { status: 400 });
    }
  }

  if (parsed.data.tradeReasonIds) {
    const tradeReasonCount = await prisma.tradeReason.count({
      where: { id: { in: parsed.data.tradeReasonIds } },
    });
    if (tradeReasonCount !== parsed.data.tradeReasonIds.length) {
      return NextResponse.json({ error: copy.paperTrading.tradeReasonsInvalid }, { status: 400 });
    }
  }

  const data = {
    ...(parsed.data.setupOptionId !== undefined ? { setupOptionId: parsed.data.setupOptionId } : {}),
    ...(parsed.data.tradeReasonIds !== undefined ? {
      tradeReasons: { set: parsed.data.tradeReasonIds.map((reasonId) => ({ id: reasonId })) },
    } : {}),
    ...(parsed.data.review !== undefined ? { review: parsed.data.review } : {}),
  };

  const include = {
      journalSession: { select: { archivedAt: true } },
      setupOption: { select: { name: true } },
      tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    } as const;
  const scope = getReplayScope()!;
  if (parsed.data.expectedProjectionId && parsed.data.expectedProjectionId !== scope.projectionId)
    return NextResponse.json({ error: copy.ai.conflict }, { status: 409 });
  let aiBaseline: ContextValue | null = null;
  if (parsed.data.aiSourceRunId) {
    const source = await prisma.aiMessage.findFirst({ where: { runId: parsed.data.aiSourceRunId, role: "assistant", status: "COMPLETED" } });
    const sourceContext = source?.contextId ? await readContext(source.contextId) : null;
    if (!sourceContext || sourceContext.replaySessionId !== scope.id || sourceContext.projectionId !== scope.projectionId
      || sourceContext.selectedEntryId !== entry.id || !source?.result)
      return NextResponse.json({ error: copy.ai.conflict }, { status: 409 });
    aiBaseline = sourceContext;
  }
  let updated;
  try {
    updated = await sqliteWriteTransaction(prisma, async (tx) => {
      const session = await tx.replaySession.findUnique({ where: { id: scope.id } });
      const round = scope.accountCategory === "PROP_PRACTICE" && entry.projectionId ? await tx.propPracticeRound.findUnique({ where: { projectionId: entry.projectionId } }) : null;
      if (!session || (session.activeProjectionId !== scope.projectionId && round?.replaySessionId !== scope.id)) throw new AiError("CONFLICT", copy.ai.conflict, 409);
      if (aiBaseline) {
        const current = await tx.replayJournalEntry.findUnique({ where: { id: entry.id }, include: { setupOption: { select: { name: true } }, tradeReasons: { select: { id: true, name: true } } } });
        if (!current || reviewFactsHash(current) !== reviewFactsHash(aiBaseline.entries[0])) throw new AiError("CONFLICT", copy.ai.conflict, 409);
      }
      if (parsed.data.review !== undefined) {
        const changed = await tx.replayJournalEntry.updateMany({
          where: { id: entry.id, projectionId: entry.projectionId, review: parsed.data.expectedReview ?? entry.review },
          data: { review: parsed.data.review },
        });
        if (!changed.count) throw new AiError("CONFLICT", copy.ai.conflict, 409);
        if (parsed.data.review !== entry.review) await tx.aiReviewRevision.create({ data: {
          replaySessionId: scope.id, projectionId: entry.projectionId!, logicalKey: entry.logicalKey ?? logicalId(entry.id),
          content: parsed.data.review, sourceRunId: parsed.data.aiSourceRunId,
        } });
      }
      return tx.replayJournalEntry.update({ where: { id: entry.id }, data, include });
    });
  } catch (error) {
    if (error instanceof AiError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const [numbered] = await withReplayJournalDisplayNumbers([updated]);
  return NextResponse.json(serializeReplayJournalEntry(numbered));
}

async function handleDELETE(_request: Request, context: RouteContext) {
  await context.params;
  const training = getReplayScope()!.mode === "TRAINING";
  return NextResponse.json({
    error: training ? copy.replaySessions.modeBlocked : copy.replaySessions.deleteNeedsCorrection,
    code: training ? "MODE_NOT_ALLOWED" : "CORRECTION_REQUIRED",
  }, { status: training ? 403 : 409 });
}

export const PATCH = withReplaySessionRoute(handlePATCH, { write: true, annotation: true });

export const DELETE = withReplaySessionRoute(handleDELETE, { write: true, annotation: true });
