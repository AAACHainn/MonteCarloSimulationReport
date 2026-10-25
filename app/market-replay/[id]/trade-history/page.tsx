import { OwnershipContext } from "@/components/user-growth/ownership-context";
import { UserEntry } from "@/components/user-growth/user-entry";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PaperJournalTable } from "@/components/market-replay/paper-journal-table";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { listReplaySessions } from "@/lib/replay-sessions/read";
import { ReplaySessionProvider } from "@/components/market-replay/replay-session-context";
import { PropRoundHistory, PropRoundTradingRecords } from "@/components/market-replay/prop-round-history";
import { PropAccountPanel } from "@/components/market-replay/prop-account-panel";
import { loadReplayScope, loadPropRoundScope, runWithReplayScope } from "@/lib/replay-sessions/scope";
import { listPropRounds } from "@/lib/prop-practice/rounds";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";

export const dynamic = "force-dynamic";

export default async function ReplayTradeHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sessionId?: string; propRound?: string }> }) {
  const { id } = await params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true, name: true, symbol: true } });
  if (!dataset) notFound();
  const query = await searchParams;
  const sessions = await listReplaySessions(id);
  const sessionId = query.sessionId;
  if (!sessionId && sessions.length === 0) redirect(`/market-replay/${id}`);
  const session = sessionId ? sessions.find((session) => session.id === sessionId) : sessions[0];
  if (!session) notFound();
  const baseScope = await loadReplayScope(session.id);
  const isProp = session.accountCategory === "PROP_PRACTICE";
  const number = isProp ? Number(query.propRound ?? 0) : undefined;
  const rounds = isProp ? await runWithReplayScope(baseScope, listPropRounds) : [];
  if (number !== undefined && (!Number.isSafeInteger(number) || number < 0 || number > 0 && !rounds.some(round => round.number === number))) notFound();
  const selectedScope = number !== undefined ? await loadPropRoundScope(baseScope, number) : baseScope;
  const snapshot = number && number > 0 ? await runWithReplayScope(selectedScope, () => getPaperSessionSnapshot(id)) : null;
  const selectedSession = { ...session, activeProjectionId: selectedScope.projectionId, propRoundNumber: number };
  return <ReplaySessionProvider key={`${session.id}:${number}:${selectedScope.projectionId}`} session={selectedSession}><div className="relative left-1/2 w-[calc(100vw-2rem)] max-w-[1800px] -translate-x-1/2 space-y-6 sm:w-[calc(100vw-3rem)]">
    <Breadcrumbs items={[
      { label: copy.marketReplay.title, href: "/market-replay" },
      { label: dataset.name, href: `/market-replay/${id}` },
      { label: copy.paperTrading.journalHistory },
    ]} />
    <section className="border-b pb-5">
      <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{dataset.symbol}</p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.paperTrading.journalHistory}</h1>
      <p className="mt-2 text-sm text-slate-600">{copy.paperTrading.journalHistoryDescription}</p>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3"><OwnershipContext session={session} /><UserEntry /></div>
    {isProp ? <PropRoundHistory datasetId={id} sessionId={session.id} rounds={rounds} selected={number!} /> : null}
    {snapshot?.propAccount ? <PropAccountPanel sessionId={session.id} runtime={snapshot.propAccount} tradingSnapshot={snapshot} readOnly /> : null}
    {snapshot?.propAccount?.state.result ? <PropRoundTradingRecords snapshot={snapshot} /> : null}
    <PaperJournalTable datasetId={id} scope="history" replaySessions={sessions} />
  </div></ReplaySessionProvider>;
}
