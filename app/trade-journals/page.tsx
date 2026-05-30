import { Breadcrumbs } from "@/components/breadcrumbs";
import { JournalDashboard } from "@/components/trade-journals/journal-dashboard";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function TradeJournalsPage() {
  const [journals, options] = await Promise.all([
    prisma.tradeJournal.findMany({
      orderBy: { createdAt: "desc" },
      include: { dataset: { include: { _count: { select: { trades: true, simulationRuns: true } } } } },
    }),
    prisma.tradeOption.findMany({ orderBy: [{ type: "asc" }, { active: "desc" }, { name: "asc" }] }),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: copy.tradeJournals.title }]} />
      <section className="border-b pb-6">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.tradeJournals.eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.tradeJournals.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">{copy.tradeJournals.subtitle}</p>
      </section>
      <JournalDashboard
        journals={journals.map((journal) => ({
          id: journal.id,
          name: journal.name,
          description: journal.description,
          dataset: journal.dataset,
        }))}
        options={options.map((option) => ({
          id: option.id,
          type: option.type,
          name: option.name,
          active: option.active,
        }))}
      />
    </div>
  );
}
