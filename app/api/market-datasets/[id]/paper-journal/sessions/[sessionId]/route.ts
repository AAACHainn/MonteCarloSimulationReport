import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { replayJournalSessionNameSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id, sessionId } = await context.params;
  const parsed = replayJournalSessionNameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const session = await prisma.replayJournalSession.findFirst({
    where: { id: sessionId, datasetId: id },
    select: { id: true },
  });
  if (!session) return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });
  const updated = await prisma.replayJournalSession.update({
    where: { id: sessionId },
    data: { name: parsed.data.name },
    select: { id: true, name: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, sessionId } = await context.params;
  const session = await prisma.replayJournalSession.findFirst({ where: { id: sessionId, datasetId: id } });
  if (!session) return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });
  if (!session.archivedAt) {
    return NextResponse.json({ error: copy.paperTrading.journalActiveDeleteBlocked }, { status: 409 });
  }
  await prisma.replayJournalSession.delete({ where: { id: sessionId } });
  return NextResponse.json({ ok: true });
}
