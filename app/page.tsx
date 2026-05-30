import Link from "next/link";
import { ArrowRight, BarChart3, Database, History, NotebookTabs } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";

const actions = [
  {
    href: "/trade-journals",
    icon: NotebookTabs,
    title: copy.home.manageTradeJournals,
    body: copy.home.manageTradeJournalsBody,
  },
  {
    href: "/datasets",
    icon: Database,
    title: copy.home.manageDatasets,
    body: copy.home.manageDatasetsBody,
  },
  {
    href: "/simulations/new",
    icon: BarChart3,
    title: copy.home.runMonteCarlo,
    body: copy.home.runMonteCarloBody,
  },
  {
    href: "/simulations/history",
    icon: History,
    title: copy.home.openHistory,
    body: copy.home.openHistoryBody,
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 border-b pb-8">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.home.eyebrow}</p>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950">{copy.home.title}</h1>
          <p className="text-lg text-slate-600">{copy.home.description}</p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/datasets">
              {copy.home.start}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/simulations/history">{copy.home.history}</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => (
          <Card key={action.href}>
            <CardHeader>
              <action.icon className="h-5 w-5 text-blue-700" />
              <CardTitle>{action.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">{action.body}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href={action.href}>{copy.home.open}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
