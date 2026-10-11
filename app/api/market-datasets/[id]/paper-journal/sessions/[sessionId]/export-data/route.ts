import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { readReplayJournalFilters, compileReplayJournalFilters } from "@/lib/paper-trading/journal-filters";
import { calculateReplayJournalSummary, serializeReplayJournalEntry } from "@/lib/paper-trading/journal";
import { describePdfFilters } from "@/lib/paper-trading/pdf-settings";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";
import type { PdfSnapshot } from "@/lib/paper-trading/pdf-types";

export async function GET(request: Request, context: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id, sessionId } = await context.params;
  const filters = readReplayJournalFilters(new URL(request.url).searchParams);
  const compiled = compileReplayJournalFilters(filters);
  if (compiled.error) return NextResponse.json({ error: copy.paperTrading.journalFilterInvalid }, { status: 400 });
  const records = await prisma.$transaction(async (tx) => {
    const dataset = await tx.marketDataset.findUnique({ where: { id } });
    const session = await tx.replayJournalSession.findFirst({
      where: { id: sessionId, datasetId: id },
      include: { entries: { include: { setupOption: { select: { name: true } }, tradeReasons: { select: { id: true, name: true }, orderBy: { name: "asc" } } }, orderBy: [{ accountNo: "asc" }, { id: "asc" }] } },
    });
    return { dataset, session, capturedAt: new Date().toISOString() };
  });
  if (!records.dataset || records.dataset.status !== "READY" || !records.session)
    return NextResponse.json({ error: copy.paperTrading.journalNotFound }, { status: 404 });
  const all = records.session.entries.map((e) => serializeReplayJournalEntry({ ...e, journalSession: { archivedAt: records.session!.archivedAt } }));
  const entries = all.filter(compiled.test);
  const snapshot: PdfSnapshot = {
    session: { id: records.session.id, name: records.session.name, createdAt: records.session.createdAt.toISOString(), totalCount: all.length },
    dataset: serializeMarketDataset({ ...records.dataset, progress: null }),
    entries, summary: calculateReplayJournalSummary(entries), filters,
    filterDescription: describePdfFilters(filters, all), capturedAt: records.capturedAt, endSequence: records.dataset.barCount - 1,
  };
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
