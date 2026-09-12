import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

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
