import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { compileReplayJournalFilters, readReplayJournalFilters } from "@/lib/paper-trading/journal-filters";
import { calculateReplayJournalSummary, serializeReplayJournalEntry } from "@/lib/paper-trading/journal";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "current" ? "current" : "history";
  const take = Math.min(100, Math.max(10, Math.floor(Number(url.searchParams.get("take") ?? 20) || 20)));
  const requestedPage = Math.max(1, Math.floor(Number(url.searchParams.get("page") ?? 1) || 1));
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true } });
  if (!dataset) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });

  if (scope === "current") {
    const current = await prisma.paperTradingSession.findUnique({
      where: { datasetId: id }, select: { journalSessionId: true },
    });
    const allRecords = await prisma.replayJournalEntry.findMany({
      where: { journalSessionId: current?.journalSessionId ?? "__none__" },
      include: {
        journalSession: { select: { archivedAt: true } },
        setupOption: { select: { name: true } },
        tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
      orderBy: [{ accountNo: "asc" }, { id: "asc" }],
    });
    const serializedRecords = allRecords.map(serializeReplayJournalEntry);
    const totalItems = serializedRecords.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / take));
    const page = Math.min(requestedPage, totalPages);
    const pageStart = (page - 1) * take;
    return NextResponse.json({
      items: serializedRecords.slice(pageStart, pageStart + take),
      sessions: [],
      pagination: { page, pageSize: take, totalItems, totalPages },
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

  const filters = readReplayJournalFilters(url.searchParams);
  const compiledFilters = compileReplayJournalFilters(filters);
  if (compiledFilters.error) {
    return NextResponse.json({ error: copy.paperTrading.journalFilterInvalid }, { status: 400 });
  }

  const allRecords = selectedSession ? await prisma.replayJournalEntry.findMany({
    where: { journalSessionId: selectedSession.id },
    include: {
      journalSession: { select: { archivedAt: true } },
      setupOption: { select: { name: true } },
      tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
    orderBy: [{ accountNo: "asc" }, { id: "asc" }],
  }) : [];
  const serializedRecords = allRecords.map(serializeReplayJournalEntry);
  const setupFilterOptions = new Map<string, string>();
  const tradeReasonFilterOptions = new Map<string, string>();
  let hasEntriesWithoutSetup = false;
  let hasEntriesWithoutTradeReason = false;
  for (const record of serializedRecords) {
    if (record.setupOptionId && record.setupOption) {
      setupFilterOptions.set(record.setupOptionId, record.setupOption.name);
    } else {
      hasEntriesWithoutSetup = true;
    }
    if (record.tradeReasons.length === 0) hasEntriesWithoutTradeReason = true;
    for (const reason of record.tradeReasons) tradeReasonFilterOptions.set(reason.id, reason.name);
  }
  const filteredRecords = serializedRecords.filter(compiledFilters.test);
  const totalItems = filteredRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / take));
  const page = Math.min(requestedPage, totalPages);
  const pageStart = (page - 1) * take;
  const records = filteredRecords.slice(pageStart, pageStart + take);

  return NextResponse.json({
    items: records,
    sessions: sessions.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      archivedAt: session.archivedAt?.toISOString() ?? null,
      entryCount: session._count.entries,
      _count: undefined,
    })),
    selectedSessionId: selectedSession?.id ?? null,
    filterOptions: {
      setups: [...setupFilterOptions].map(([value, label]) => ({ value, label })),
      hasEntriesWithoutSetup,
      tradeReasons: [...tradeReasonFilterOptions].map(([value, label]) => ({ value, label })),
      hasEntriesWithoutTradeReason,
    },
    summary: calculateReplayJournalSummary(filteredRecords),
    pagination: { page, pageSize: take, totalItems, totalPages },
  });
}
