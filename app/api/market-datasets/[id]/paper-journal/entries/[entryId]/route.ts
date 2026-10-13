import { withReplaySessionRoute, journalScopeWhere, getReplayScope } from '@/lib/replay-sessions/scope';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeReplayJournalEntry } from "@/lib/paper-trading/journal";
import { replayJournalEntryUpdateSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

async function handlePATCH(request: Request, context: RouteContext) {
  const { id, entryId } = await context.params;
  const parsed = replayJournalEntryUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: copy.paperTrading.journalEntryUpdateInvalid }, { status: 400 });
  }

  const entry = await prisma.replayJournalEntry.findFirst({
    where: { id: entryId, journalSession: { datasetId: id, ...journalScopeWhere() } },
    select: { id: true, logicalKey: true, journalSessionId: true },
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
  const updated = await prisma.$transaction(async (tx) => {
    const versions = entry.logicalKey ? await tx.replayJournalEntry.findMany({
      where: { journalSessionId: entry.journalSessionId, logicalKey: entry.logicalKey }, select: { id: true },
    }) : [{ id: entry.id }];
    for (const version of versions) await tx.replayJournalEntry.update({ where: { id: version.id }, data });
    return tx.replayJournalEntry.findUniqueOrThrow({ where: { id: entry.id }, include });
  });
  return NextResponse.json(serializeReplayJournalEntry(updated));
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
