import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { MarketReplayClient } from "@/components/market-replay/market-replay-client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";
import { ReplaySessionsDashboard } from "@/components/market-replay/replay-sessions-dashboard";
import { ReplaySessionProvider } from "@/components/market-replay/replay-session-context";
import { PaperJournalTable } from "@/components/market-replay/paper-journal-table";
import { HistoricalReplayClient } from "@/components/market-replay/historical-replay-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listReplaySessions, replaySessionView } from "@/lib/replay-sessions/read";
import { ReplayProjectionPicker } from "@/components/market-replay/replay-projection-picker";
import { PaperAccountStrip } from "@/components/market-replay/paper-trading-panel";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { runWithReplayScope } from "@/lib/replay-sessions/scope";

export const dynamic = "force-dynamic";

export default async function MarketReplayDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sessionId?: string; projectionId?: string; focusSequence?: string; journalNo?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, include: { progress: true } });
  if (!dataset) notFound();
  const requestedJournalNo = Number(query.journalNo);
  let journalEntry = Number.isInteger(requestedJournalNo) && requestedJournalNo > 0
    ? await prisma.replayJournalEntry.findFirst({
      where: { no: requestedJournalNo, journalSession: { datasetId: id, ...(query.sessionId ? { replaySessionId: query.sessionId } : {}) }, projection: { status: { in: ["CURRENT", "HISTORICAL"] } } },
      orderBy: { projection: { generation: "desc" } },
      select: { no: true, accountNo: true, openedSequence: true, projectionId: true, journalSessionId: true, journalSession: { select: { replaySessionId: true } } },
    })
    : null;
  if (!query.sessionId && journalEntry?.journalSession.replaySessionId) {
    redirect(`/market-replay/${id}?sessionId=${encodeURIComponent(journalEntry.journalSession.replaySessionId)}&journalNo=${requestedJournalNo}`);
  }
  const sessions = await listReplaySessions(id);
  let selected = query.sessionId ? sessions.find((session) => session.id === query.sessionId) : null;
  if (query.sessionId && !selected) notFound();
  if (selected && query.projectionId) { selected = await replaySessionView(selected, query.projectionId); if (!selected) notFound(); }
  if (selected && journalEntry && journalEntry.projectionId !== selected.activeProjectionId) {
    const currentEntry = await prisma.replayJournalEntry.findFirst({
      where: { no: requestedJournalNo, projectionId: selected.activeProjectionId },
      select: { no: true, accountNo: true, openedSequence: true, projectionId: true, journalSessionId: true, journalSession: { select: { replaySessionId: true } } },
    });
    if (!currentEntry && !query.projectionId && journalEntry.projectionId) {
      redirect(`/market-replay/${id}/history/${journalEntry.journalSessionId}?trade=${journalEntry.accountNo}&projectionId=${encodeURIComponent(journalEntry.projectionId)}`);
    }
    journalEntry = currentEntry;
  }
  const serialized = serializeMarketDataset({ ...dataset, progress: selected
    ? dataset.progress.find((progress) => progress.replaySessionId === selected.id) ?? null : null });
  if (!selected) return <div className="space-y-6">
    <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name }]} />
    <section className="border-b pb-6"><h1 className="text-3xl font-semibold tracking-tight text-slate-950">{dataset.name} · {copy.replaySessions.title}</h1></section>
    <ReplaySessionsDashboard dataset={serialized} initialSessions={sessions} />
  </div>;
  if (selected.status === "ARCHIVED") {
    const projection = await prisma.replayProjection.findUniqueOrThrow({ where: { id: selected.activeProjectionId } });
    const journal = await prisma.replayJournalSession.findUnique({ where: { replaySessionId: selected.id } });
    const snapshot = await runWithReplayScope({ id: selected.id, datasetId: id, projectionId: selected.activeProjectionId,
      mode: selected.mode, status: "ARCHIVED", version: selected.version }, () => getPaperSessionSnapshot(id));
    return <ReplaySessionProvider session={selected}><div className="space-y-6">
      <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name, href: `/market-replay/${id}` }, { label: selected.name }]} />
      <section className="flex items-center justify-between gap-4 border-b pb-6">
        <div><h1 className="text-3xl font-semibold tracking-tight text-slate-950">{selected.name}</h1><div className="mt-2 flex gap-2"><Badge>{query.projectionId ? copy.replaySessions.historicalVersion : copy.replaySessions.archived}</Badge><Badge>{selected.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay}</Badge></div><p className="mt-2 text-sm text-slate-600">{query.projectionId ? copy.replaySessions.versionReadOnly : copy.replaySessions.readOnly} · {copy.replaySessions.source}</p></div>
        <Button asChild variant="outline"><Link href={`/market-replay/${id}`}>{copy.replaySessions.allSessions}</Link></Button>
      </section>
      <div className="flex items-center justify-between gap-4"><ReplayProjectionPicker baseHref={`/market-replay/${id}?sessionId=${encodeURIComponent(selected.id)}`} />
        {query.projectionId ? <Button asChild variant="outline" size="sm"><Link href={`/market-replay/${id}?sessionId=${encodeURIComponent(selected.id)}`}>{copy.replaySessions.returnCurrent}</Link></Button> : null}</div>
      <PaperAccountStrip snapshot={snapshot} />
      <div className="h-[70dvh] min-h-96">{projection.currentSequence >= 0 ? <HistoricalReplayClient dataset={serialized} session={{
        id: journal?.id ?? selected.id, startSequence: selected.progress?.startSequence ?? 0,
        endSequence: projection.currentSequence,
        displayIntervalSeconds: selected.progress?.displayIntervalSeconds ?? dataset.sourceIntervalSeconds ?? 60,
        displaySession: selected.progress?.displaySession ?? "ETH",
      }} focusSequence={selected.progress?.currentSequence ?? 0} /> : <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-slate-600">{copy.marketReplay.waiting}</div>}</div>
      <PaperJournalTable datasetId={id} scope="history" />
    </div></ReplaySessionProvider>;
  }
  return (
    <div className="market-replay-page relative left-1/2 flex h-[calc(100dvh-4.3125rem)] w-[calc(100vw-2rem)] max-w-none -translate-x-1/2 flex-col gap-2 overflow-hidden sm:w-[calc(100vw-3rem)]">
      <div className="shrink-0">
        <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name }]} />
        <div className="mt-1 flex items-baseline gap-3">
          <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950">{copy.marketReplay.replayTitle(dataset.symbol, dataset.timeframe)}</h1>
          <p className="truncate text-xs text-slate-500">{dataset.name} · {dataset.timezone}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1"><ReplaySessionProvider session={selected}><MarketReplayClient key={`${serialized.id}:${selected.id}:${selected.activeProjectionId}`} dataset={serialized} initialJournalFocus={journalEntry ? { sequence: journalEntry.openedSequence, no: journalEntry.accountNo, globalNo: journalEntry.no } : null} /></ReplaySessionProvider></div>
    </div>
  );
}
