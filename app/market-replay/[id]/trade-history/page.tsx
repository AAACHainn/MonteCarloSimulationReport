import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PaperJournalTable } from "@/components/market-replay/paper-journal-table";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { listReplaySessions, replaySessionView } from "@/lib/replay-sessions/read";
import { ReplayProjectionPicker } from "@/components/market-replay/replay-projection-picker";
import { ReplaySessionProvider } from "@/components/market-replay/replay-session-context";

export const dynamic = "force-dynamic";

export default async function ReplayTradeHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sessionId?: string; projectionId?: string }> }) {
  const { id } = await params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, select: { id: true, name: true, symbol: true } });
  if (!dataset) notFound();
  const query = await searchParams;
  const sessionId = query.sessionId;
  if (!sessionId) redirect(`/market-replay/${id}`);
  let session = (await listReplaySessions(id)).find((session) => session.id === sessionId);
  if (!session) notFound();
  if (query.projectionId) { const view = await replaySessionView(session, query.projectionId); if (!view) notFound(); session = view; }
  return <ReplaySessionProvider session={session}><div className="relative left-1/2 w-[calc(100vw-2rem)] max-w-[1800px] -translate-x-1/2 space-y-6 sm:w-[calc(100vw-3rem)]">
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
    <ReplayProjectionPicker baseHref={`/market-replay/${id}/trade-history?sessionId=${encodeURIComponent(session.id)}`} />
    <PaperJournalTable datasetId={id} scope="history" />
  </div></ReplaySessionProvider>;
}
