import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { MarketReplayClient } from "@/components/market-replay/market-replay-client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";

export const dynamic = "force-dynamic";

export default async function MarketReplayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dataset = await prisma.marketDataset.findUnique({ where: { id }, include: { progress: true } });
  if (!dataset) notFound();
  const serialized = serializeMarketDataset(dataset);
  return (
    <div className="relative left-1/2 w-[calc(100vw-2rem)] max-w-none -translate-x-1/2 space-y-6 sm:w-[calc(100vw-3rem)]">
      <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name }]} />
      <section className="border-b pb-6">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.marketReplay.eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.marketReplay.replayTitle(dataset.symbol, dataset.timeframe)}</h1>
        <p className="mt-2 text-sm text-slate-600">{dataset.name} · {dataset.timezone} · {dataset.barCount.toLocaleString("zh-CN")} {copy.marketReplay.bars}</p>
      </section>
      <MarketReplayClient dataset={serialized} />
    </div>
  );
}
