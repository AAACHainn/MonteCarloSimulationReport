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
    <div className="relative left-1/2 flex h-[calc(100dvh-8.3125rem)] w-[calc(100vw-2rem)] max-w-none -translate-x-1/2 flex-col gap-2 overflow-hidden sm:w-[calc(100vw-3rem)]">
      <div className="shrink-0">
        <Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: dataset.name }]} />
        <div className="mt-1 flex items-baseline gap-3">
          <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950">{copy.marketReplay.replayTitle(dataset.symbol, dataset.timeframe)}</h1>
          <p className="truncate text-xs text-slate-500">{dataset.name} · {dataset.timezone} · {dataset.barCount.toLocaleString("zh-CN")} {copy.marketReplay.bars}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1"><MarketReplayClient dataset={serialized} /></div>
    </div>
  );
}
