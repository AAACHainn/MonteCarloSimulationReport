import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeReplayJournalEntry } from "@/lib/paper-trading/journal";
import { replayJournalEntryUpdateSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id, entryId } = await context.params;
  const parsed = replayJournalEntryUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: copy.paperTrading.journalEntryUpdateInvalid }, { status: 400 });
  }

  const entry = await prisma.replayJournalEntry.findFirst({
    where: { id: entryId, journalSession: { datasetId: id } },
    select: { id: true },
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

  const updated = await prisma.replayJournalEntry.update({
    where: { id: entry.id },
    data,
    include: {
      journalSession: { select: { archivedAt: true } },
      setupOption: { select: { name: true } },
      tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  });
  return NextResponse.json(serializeReplayJournalEntry(updated));
}

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
