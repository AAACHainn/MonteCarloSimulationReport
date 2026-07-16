import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Play } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DeleteJournalButton } from "@/components/trade-journals/delete-journal-button";
import { JournalTableSection } from "@/components/trade-journals/journal-table-section";
import { MergeJournalImport } from "@/components/trade-journals/merge-journal-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { formatNumber, formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { calculateJournalStats } from "@/lib/trade-journal/calculations";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function TradeJournalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [journal, options] = await Promise.all([
    prisma.tradeJournal.findUnique({
      where: { id },
      include: {
        dataset: {
          include: {
            trades: {
              orderBy: [{ date: "asc" }, { createdAt: "asc" }],
              include: { instrumentOption: true, strategyOption: true },
            },
          },
        },
      },
    }),
    prisma.tradeOption.findMany({ orderBy: [{ type: "asc" }, { active: "desc" }, { name: "asc" }] }),
  ]);
  if (!journal) notFound();

  const stats = calculateJournalStats(journal.dataset.trades.map((trade) => trade.rMultiple));
  const trades = journal.dataset.trades.map((trade) => ({
    id: trade.id,
    date: trade.date?.toISOString().slice(0, 10) ?? "",
    direction: trade.direction,
    riskAmount: trade.riskAmount,
    rMultiple: trade.rMultiple,
    instrumentOptionId: trade.instrumentOptionId,
    strategyOptionId: trade.strategyOptionId,
    instrumentOption: trade.instrumentOption ? { name: trade.instrumentOption.name } : null,
    strategyOption: trade.strategyOption ? { name: trade.strategyOption.name } : null,
    entryPrice: trade.entryPrice,
    stopLossPrice: trade.stopLossPrice,
    targetPrice: trade.targetPrice,
    exitPrice: trade.exitPrice,
    strategyCode: trade.strategyCode,
    screenshotPath: trade.screenshotPath,
  }));
  const serializedOptions = options.map((option) => ({
    id: option.id,
    type: option.type,
    name: option.name,
    active: option.active,
  }));

  return (
    <div className="relative left-1/2 w-[calc(100vw-3rem)] -translate-x-1/2 space-y-6">
      <div className="mx-auto w-full max-w-[1800px] space-y-6">
        <Breadcrumbs items={[{ label: copy.tradeJournals.title, href: "/trade-journals" }, { label: journal.name }]} />
        <section className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.tradeJournals.eyebrow}</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{journal.name}</h1>
            <p className="mt-2 text-sm text-slate-600">{journal.description || copy.tradeJournals.detailDescription}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/simulations/new?datasetId=${journal.datasetId}`}><Play className="h-4 w-4" />{copy.tradeJournals.runSimulation}</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={`/api/trade-journals/${journal.id}/export`}><Download className="h-4 w-4" />{copy.tradeJournals.export}</a>
            </Button>
            <MergeJournalImport journalId={journal.id} />
            <DeleteJournalButton journalId={journal.id} />
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard label={copy.tradeJournals.statTradeCount} value={String(stats.tradeCount)} />
          <StatCard label={copy.tradeJournals.statWinRate} value={formatPercent(stats.winRate)} />
          <StatCard label={copy.tradeJournals.statTotalR} value={`${formatNumber(stats.totalR)} R`} />
          <StatCard label={copy.tradeJournals.statAverageR} value={`${formatNumber(stats.averageR)} R`} />
          <StatCard label={copy.tradeJournals.statMedianR} value={`${formatNumber(stats.medianR)} R`} />
          <StatCard label={copy.tradeJournals.statMaxLosingStreak} value={String(stats.maxLosingStreak)} />
        </section>
      </div>

      <JournalTableSection journalId={journal.id} trades={trades} options={serializedOptions} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-2 font-mono text-xl font-semibold text-slate-950">{value}</div>
      </CardContent>
    </Card>
  );
}
