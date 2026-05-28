import Link from "next/link";
import { ArrowRight, BarChart3, Database, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const actions = [
  {
    href: "/datasets",
    icon: Database,
    title: "Manage Trade Datasets",
    body: "Create a dataset, upload CSV trades, and inspect computed R-multiples.",
  },
  {
    href: "/simulations/new",
    icon: BarChart3,
    title: "Run Monte Carlo",
    body: "Configure risk, compounding, ruin threshold, and bootstrap scenarios.",
  },
  {
    href: "/simulations/history",
    icon: History,
    title: "Open History",
    body: "Review saved reports without rerunning the full simulation.",
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 border-b pb-8">
        <p className="font-mono text-sm uppercase tracking-wide text-blue-700">Trading System Risk Lab</p>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Monte Carlo Simulation Report</h1>
          <p className="text-lg text-slate-600">
            Upload historical trades, transform them into R-multiples, and stress-test the system with bootstrap
            simulations, drawdown analysis, ruin probability, and percentile equity curves.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/datasets">
              Start with a Dataset
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/simulations/history">View History</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {actions.map((action) => (
          <Card key={action.href}>
            <CardHeader>
              <action.icon className="h-5 w-5 text-blue-700" />
              <CardTitle>{action.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">{action.body}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href={action.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
