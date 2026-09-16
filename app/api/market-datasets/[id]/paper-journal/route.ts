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
  const defaultTake = scope === "history" ? 20 : 100;
  const take = Math.min(100, Math.max(10, Math.floor(Number(url.searchParams.get("take") ?? defaultTake) || defaultTake)));
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });

  if (scope === "current") {
    const current = await prisma.paperTradingSession.findUnique({
      where: { datasetId: id }, select: { journalSessionId: true },
    });
    const records = await prisma.replayJournalEntry.findMany({
      where: { journalSessionId: current?.journalSessionId ?? "__none__", no: { gt: cursor } },
      include: {
        journalSession: { select: { archivedAt: true } },
        setupOption: { select: { name: true } },
        reasonTags: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
      orderBy: { no: "asc" },
      take: take + 1,
    });
    const hasMore = records.length > take;
    const pageRecords = records.slice(0, take);
    return NextResponse.json({
      items: pageRecords.map(serializeReplayJournalEntry),
      sessions: [],
      nextCursor: hasMore ? pageRecords.at(-1)?.no ?? null : null,
    });
  }

  const sessions = await prisma.replayJournalSession.findMany({
    where: { datasetId: id, entries: { some: {} } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, name: true, replayGeneration: true, initialCapital: true, currency: true,
      archivedAt: true, createdAt: true, _count: { select: { entries: true } },
    },
  });
  const requestedSessionId = url.searchParams.get("sessionId")?.trim() || null;
  const selectedSession = requestedSessionId
    ? sessions.find((session) => session.id === requestedSessionId)
    : sessions[0];
  if (requestedSessionId && !selectedSession) {
    return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });
  }

  const requestedPage = Math.max(1, Math.floor(Number(url.searchParams.get("page") ?? 1) || 1));
  const totalItems = selectedSession?._count.entries ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / take));
  const page = Math.min(requestedPage, totalPages);
  const records = selectedSession ? await prisma.replayJournalEntry.findMany({
    where: { journalSessionId: selectedSession.id },
    include: {
      journalSession: { select: { archivedAt: true } },
      setupOption: { select: { name: true } },
      reasonTags: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
    orderBy: [{ accountNo: "asc" }, { id: "asc" }],
    skip: (page - 1) * take,
    take,
  }) : [];

  return NextResponse.json({
    items: records.map(serializeReplayJournalEntry),
    sessions: sessions.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      archivedAt: session.archivedAt?.toISOString() ?? null,
      entryCount: session._count.entries,
      _count: undefined,
    })),
    selectedSessionId: selectedSession?.id ?? null,
    pagination: { page, pageSize: take, totalItems, totalPages },
    nextCursor: null,
  });
}
