import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, entryId } = await context.params;
  const entry = await prisma.replayJournalEntry.findFirst({
    where: { id: entryId, journalSession: { datasetId: id } },
    include: { journalSession: { select: { archivedAt: true } } },
  });
  if (!entry) return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });
  if (!entry.journalSession.archivedAt) {
    return NextResponse.json({ error: copy.paperTrading.journalActiveDeleteBlocked }, { status: 409 });
  }
  await prisma.replayJournalEntry.delete({ where: { id: entryId } });
  return NextResponse.json({ ok: true });
}
