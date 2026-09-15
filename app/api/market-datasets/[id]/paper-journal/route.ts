import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeReplayJournalEntry } from "@/lib/paper-trading/journal";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "current" ? "current" : "history";
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0) || 0);
  const take = Math.min(200, Math.max(10, Number(url.searchParams.get("take") ?? 100) || 100));
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });

  const current = await prisma.paperTradingSession.findUnique({
    where: { datasetId: id }, select: { journalSessionId: true },
  });
  const where = scope === "current"
    ? { journalSessionId: current?.journalSessionId ?? "__none__", no: { gt: cursor } }
    : { journalSession: { datasetId: id }, no: { gt: cursor } };
  const records = await prisma.replayJournalEntry.findMany({
    where,
    include: {
      journalSession: { select: { archivedAt: true } },
      setupOption: { select: { name: true } },
    },
    orderBy: { no: "asc" },
    take: take + 1,
  });
  const hasMore = records.length > take;
  const pageRecords = records.slice(0, take);
  const items = pageRecords.map(serializeReplayJournalEntry);
  const sessions = scope === "history" ? await prisma.replayJournalSession.findMany({
    where: { datasetId: id, entries: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, replayGeneration: true, initialCapital: true, currency: true,
      archivedAt: true, createdAt: true, _count: { select: { entries: true } },
    },
  }) : [];
  return NextResponse.json({
    items,
    sessions: sessions.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      archivedAt: session.archivedAt?.toISOString() ?? null,
      entryCount: session._count.entries,
      _count: undefined,
    })),
    nextCursor: hasMore ? pageRecords.at(-1)?.no ?? null : null,
  });
}
