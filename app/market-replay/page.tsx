import { Breadcrumbs } from "@/components/breadcrumbs";
import { MarketDatasetDashboard } from "@/components/market-replay/market-dataset-dashboard";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";

export const dynamic = "force-dynamic";

export default async function MarketReplayPage() {
  const datasets = await prisma.marketDataset.findMany({ where: { status: "READY" }, include: { progress: true }, orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: copy.marketReplay.title }]} />
      <section className="border-b pb-6">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700 dark:text-link">{copy.marketReplay.eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-foreground">{copy.marketReplay.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-secondary-text">{copy.marketReplay.subtitle}</p>
      </section>
      <MarketDatasetDashboard datasets={datasets.map(serializeMarketDataset)} />
    </div>
  );
}
