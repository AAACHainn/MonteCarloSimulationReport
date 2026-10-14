import { withReplaySessionRoute, journalScopeWhere, getReplayScope, assertReplayWritable, markReplayMutation } from '@/lib/replay-sessions/scope';
import { deleteReplaySession, deleteReplaySessionSchema } from '@/lib/replay-sessions/service';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { replayJournalSessionNameSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

async function handlePATCH(request: Request, context: RouteContext) {
  const { id, sessionId } = await context.params;
  const parsed = replayJournalSessionNameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const session = await prisma.replayJournalSession.findFirst({
    where: { id: sessionId, datasetId: id, ...journalScopeWhere() },
    select: { id: true },
  });
  if (!session) return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });
  const updated = await prisma.$transaction(async (tx) => {
    await assertReplayWritable(tx);
    const updated = await tx.replayJournalSession.update({
      where: { id: sessionId }, data: { name: parsed.data.name }, select: { id: true, name: true },
    });
    await tx.replaySession.update({ where: { id: getReplayScope()!.id }, data: { name: parsed.data.name } });
    await markReplayMutation(tx);
    return updated;
  });
  return NextResponse.json(updated);
}

async function handleDELETE(request: Request, context: RouteContext) {
  const { id, sessionId } = await context.params;
  const parsed = deleteReplaySessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: copy.replaySessions.deleteInvalid }, { status: 400 });
  const session = await prisma.replayJournalSession.findFirst({ where: { id: sessionId, datasetId: id, ...journalScopeWhere() } });
  if (!session) return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });
  await prisma.$transaction((tx) => deleteReplaySession(tx, parsed.data.expectedVersion));
  return NextResponse.json({ ok: true });
}

export const PATCH = withReplaySessionRoute(handlePATCH, { write: true, annotation: false });

export const DELETE = withReplaySessionRoute(handleDELETE, { write: true, annotation: true });
