import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HistoricalReplayClient } from "@/components/market-replay/historical-replay-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";
import { formatInterval, type DisplaySession } from "@/lib/market-replay/types";

export const dynamic = "force-dynamic";

export default async function HistoricalReplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sessionId: string }>;
  searchParams: Promise<{ trade?: string }>;
}) {
  const { id, sessionId } = await params;
  const query = await searchParams;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, include: { progress: true } });
  if (!dataset) notFound();

  const session = await prisma.replayJournalSession.findFirst({
    where: { id: sessionId, datasetId: id, entries: { some: {} } },
    select: {
      id: true,
      name: true,
      replayGeneration: true,
      archivedAt: true,
    },
  });
  if (!session) notFound();

  const requestedTradeNo = Number(query.trade);
  const [bounds, requestedEntry, firstEntry] = await Promise.all([
    prisma.replayJournalEntry.aggregate({
      where: { journalSessionId: session.id },
      _min: { openedSequence: true },
      _max: { closedSequence: true },
    }),
    Number.isInteger(requestedTradeNo) && requestedTradeNo > 0
      ? prisma.replayJournalEntry.findFirst({
          where: { journalSessionId: session.id, accountNo: requestedTradeNo },
          select: {
            accountNo: true,
            openedSequence: true,
            displayIntervalSeconds: true,
            displaySession: true,
          },
        })
      : null,
    prisma.replayJournalEntry.findFirst({
      where: { journalSessionId: session.id },
      orderBy: { accountNo: "asc" },
      select: {
        accountNo: true,
        openedSequence: true,
        displayIntervalSeconds: true,
        displaySession: true,
      },
    }),
  ]);
  const entry = requestedEntry ?? firstEntry;
  const startSequence = bounds._min.openedSequence;
  const endSequence = bounds._max.closedSequence;
  if (!entry || startSequence === null || endSequence === null) notFound();

  const requestedDisplaySession = entry.displaySession === "RTH" ? "RTH" : "ETH";
  const displaySession: DisplaySession = resolveDisplaySession(dataset, requestedDisplaySession)
    ? requestedDisplaySession
    : "ETH";
  const historyHref = `/market-replay/${id}/trade-history`;
  const title = session.name || copy.paperTrading.historicalReplayTitle(session.replayGeneration);

  return <div className="relative left-1/2 flex h-[calc(100dvh-4.3125rem)] w-[calc(100vw-2rem)] max-w-none -translate-x-1/2 flex-col gap-3 overflow-hidden sm:w-[calc(100vw-3rem)]">
    <div className="shrink-0 space-y-2">
      <Breadcrumbs items={[
        { label: copy.marketReplay.title, href: "/market-replay" },
        { label: dataset.name, href: `/market-replay/${id}` },
        { label: copy.paperTrading.journalHistory, href: historyHref },
        { label: title },
      ]} />
      <section className="flex flex-col gap-3 border-b pb-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950">{title}</h1>
            <Badge className="border-blue-200 bg-blue-50 text-blue-700">{copy.paperTrading.historicalReplayReadOnly}</Badge>
            <Badge className="border-slate-200 bg-white text-slate-600">{session.archivedAt ? copy.paperTrading.journalArchived : copy.paperTrading.journalCurrent}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-600">{copy.paperTrading.historicalReplayDescription}</p>
          <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
            {dataset.symbol} · {formatInterval(entry.displayIntervalSeconds)} · {copy.paperTrading.historicalReplayRange(startSequence, endSequence)}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={historyHref}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{copy.paperTrading.backToJournalHistory}</Link>
        </Button>
      </section>
    </div>
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-white shadow-sm">
      <HistoricalReplayClient
        dataset={serializeMarketDataset(dataset)}
        session={{
          id: session.id,
          startSequence,
          endSequence,
          displayIntervalSeconds: entry.displayIntervalSeconds,
          displaySession,
        }}
        focusSequence={entry.openedSequence}
      />
    </div>
  </div>;
}
