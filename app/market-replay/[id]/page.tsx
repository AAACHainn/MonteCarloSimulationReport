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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listReplaySessions } from "@/lib/replay-sessions/read";
import { PaperAccountStrip } from "@/components/market-replay/paper-trading-panel";
import { PropAccountPanel } from "@/components/market-replay/prop-account-panel";
import { PropRoundTradingRecords } from "@/components/market-replay/prop-round-history";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { runWithReplayScope } from "@/lib/replay-sessions/scope";
import { withReplayJournalDisplayNumbers } from "@/lib/paper-trading/journal-numbering";

export const dynamic = "force-dynamic";

export default async function MarketReplayDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sessionId?: string; focusSequence?: string; journalNo?: string; create?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, include: { progress: true } });
  if (!dataset) notFound();
  const requestedJournalNo = Number(query.journalNo);
  const journalEntry = Number.isInteger(requestedJournalNo) && requestedJournalNo > 0
    ? await prisma.replayJournalEntry.findFirst({
      where: { no: requestedJournalNo, journalSession: { datasetId: id, ...(query.sessionId ? { replaySessionId: query.sessionId } : {}) }, projection: { status: "CURRENT" } },
      select: { id: true, no: true, accountNo: true, openedSequence: true, journalSession: { select: { replaySessionId: true } } },
    })
    : null;
  if (!query.sessionId && journalEntry?.journalSession.replaySessionId) {
    redirect(`/market-replay/${id}?sessionId=${encodeURIComponent(journalEntry.journalSession.replaySessionId)}&journalNo=${requestedJournalNo}`);
  }
  const sessions = await listReplaySessions(id);
  const selected = query.sessionId ? sessions.find((session) => session.id === query.sessionId) : null;
  if (query.sessionId && !selected) notFound();
  if (Number.isInteger(requestedJournalNo) && requestedJournalNo > 0 && !journalEntry) notFound();
  const serialized = serializeMarketDataset({ ...dataset, progress: selected
    ? dataset.progress.find((progress) => progress.replaySessionId === selected.id) ?? null : null });
  if (!selected) return <div className="space-y-6">
    <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name }]} />
    <section className="border-b pb-6"><h1 className="text-3xl font-semibold tracking-tight text-slate-950">{dataset.name} · {copy.replaySessions.title}</h1></section>
    <ReplaySessionsDashboard dataset={serialized} initialSessions={sessions} initialCreateOpen={query.create === "1"} />
  </div>;
  if (selected.status === "ARCHIVED") {
    const snapshot = await runWithReplayScope({ id: selected.id, datasetId: id, projectionId: selected.activeProjectionId,
      mode: selected.mode, status: "ARCHIVED", version: selected.version, accountCategory: selected.accountCategory }, () => getPaperSessionSnapshot(id));
    return <ReplaySessionProvider session={selected}><div className="space-y-6">
      <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name, href: `/market-replay/${id}` }, { label: selected.name }]} />
      <section className="flex items-center justify-between gap-4 border-b pb-6">
        <div><h1 className="text-3xl font-semibold tracking-tight text-slate-950">{selected.name}</h1><div className="mt-2 flex gap-2"><Badge>{copy.replaySessions.archived}</Badge><Badge>{selected.mode === "TRAINING" ? copy.replaySessions.training : copy.replaySessions.liveReplay}</Badge></div><p className="mt-2 text-sm text-slate-600">{copy.replaySessions.readOnly} · {copy.replaySessions.source}</p></div>
        <Button asChild variant="outline"><Link href={`/market-replay/${id}`}>{copy.replaySessions.allSessions}</Link></Button>
      </section>
      {selected.propAccount ? <PropAccountPanel sessionId={selected.id} runtime={selected.propAccount} tradingSnapshot={snapshot} /> : <PaperAccountStrip snapshot={snapshot} />}
      {snapshot?.propAccount?.state.result ? <PropRoundTradingRecords snapshot={snapshot} /> : null}
      <PaperJournalTable datasetId={id} scope="history" replaySessions={sessions} />
    </div></ReplaySessionProvider>;
  }
  const focusedEntry = journalEntry ? (await withReplayJournalDisplayNumbers([journalEntry], selected.activeProjectionId))[0] : null;
  return (
    <div className="market-replay-page relative left-1/2 flex h-[calc(100dvh-4.3125rem)] w-[calc(100vw-2rem)] max-w-none -translate-x-1/2 flex-col gap-2 overflow-hidden sm:w-[calc(100vw-3rem)]">
      <div className="min-h-0 flex-1"><ReplaySessionProvider session={selected} includeCurrentChart><MarketReplayClient key={`${serialized.id}:${selected.id}:${selected.activeProjectionId}`} dataset={serialized} initialJournalFocus={focusedEntry ? { sequence: focusedEntry.openedSequence, no: focusedEntry.accountNo, globalNo: focusedEntry.no } : null} /></ReplaySessionProvider></div>
    </div>
  );
}
