import { Breadcrumbs } from "@/components/breadcrumbs";
import { TradeOptionManager } from "@/components/master-data/trade-option-manager";
import { TradeTagManager } from "@/components/master-data/trade-tag-manager";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function MasterDataPage() {
  const [strategies, tags] = await Promise.all([
    prisma.tradeOption.findMany({
      where: { type: "STRATEGY" },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.tradeTag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { trades: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: copy.masterData.title }]} />
      <section className="border-b pb-6">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.masterData.eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.masterData.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">{copy.masterData.subtitle}</p>
      </section>
      <div className="space-y-6">
        <TradeOptionManager type="STRATEGY" options={strategies} />
        <TradeTagManager tags={tags} />
      </div>
    </div>
  );
}
