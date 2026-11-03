import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PropStatisticsTable } from "@/components/user-growth/prop-statistics-table";
import { copy } from "@/lib/i18n";
import { formatInteger, formatMoney, formatPercent } from "@/lib/format";
import { readUserPropStatistics } from "@/lib/prop-practice/read-user-statistics";

export const dynamic = "force-dynamic";

const t = copy.propPractice.statistics;
const money = (minor: bigint | number) => formatMoney(Number(minor) / 100, copy.userWallet.currency);
const signed = (minor: bigint | number) => (minor > 0 ? "+" : "") + money(minor);
const tone = (minor: bigint | number) => minor > 0 ? "text-emerald-700" : minor < 0 ? "text-red-700" : "text-slate-950";

async function Statistics({ userId, profileHref }: { userId: string; profileHref: string }) {
  let data;
  try {
    data = await readUserPropStatistics(userId);
  } catch (error) {
    console.error("Unable to read user prop statistics", error);
    return <Alert role="alert" className="border-red-200 bg-red-50">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        {t.failed}
        <form action={`${profileHref}/prop-statistics`} method="get"><Button type="submit" variant="outline">{t.retry}</Button></form>
      </AlertDescription>
    </Alert>;
  }
  if (!data) notFound();

  const { rows, outcomes, totals, feeReturnPercent } = data;
  const purchases = rows.length;
  const payoutRounds = totals.payoutRounds;
  const payoutRoundCount = formatInteger(payoutRounds);
  const metrics = [
    {
      label: t.passRate,
      value: purchases ? formatPercent(outcomes.passed / purchases * 100) : copy.common.dash,
      color: purchases ? "text-blue-700" : "text-slate-500",
      hint: t.outcomeSummary(
        formatInteger(outcomes.passed), formatInteger(purchases),
        formatInteger(outcomes.notPassed), formatInteger(outcomes.pending),
      ),
      scope: t.passScope,
    },
    {
      label: t.payoutAfterPassRate,
      value: outcomes.passed ? formatPercent(payoutRounds / outcomes.passed * 100) : copy.common.dash,
      color: outcomes.passed ? "text-blue-700" : "text-slate-500",
      hint: t.payoutAfterPassHint(payoutRoundCount, formatInteger(outcomes.passed)),
      scope: t.payoutAfterPassScope,
    },
    {
      label: t.payoutAfterPurchaseRate,
      value: purchases ? formatPercent(payoutRounds / purchases * 100) : copy.common.dash,
      color: purchases ? "text-blue-700" : "text-slate-500",
      hint: t.payoutAfterPurchaseHint(payoutRoundCount, formatInteger(purchases)),
      scope: t.payoutAfterPurchaseScope,
    },
    { label: t.net, value: signed(totals.net), hint: t.netHint, scope: t.netScope, color: tone(totals.net) },
    {
      label: t.feeReturn,
      value: feeReturnPercent === null ? copy.common.dash : `${feeReturnPercent > 0 ? "+" : ""}${formatPercent(feeReturnPercent)}`,
      hint: feeReturnPercent === null ? t.feeReturnNoFees : t.feeReturnHint,
      scope: t.feeReturnScope,
      color: tone(feeReturnPercent ?? 0),
    },
  ];
  return <>
    <p className="text-xs text-slate-600">{t.description(data.nickname)}</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map(metric => <Card key={metric.label}>
        <CardHeader>
          <div className="flex items-center gap-1">
            <CardTitle>{metric.label}</CardTitle>
            <InfoTooltip label={t.metricHelpLabel(metric.label)} text={metric.scope} />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className={`text-2xl font-semibold tabular-nums ${metric.color}`}>{metric.value}</p>
          <p className="text-xs text-slate-600">{metric.hint}</p>
        </CardContent>
      </Card>)}
    </div>
    <Card>
      <CardHeader><CardTitle>{t.breakdown}</CardTitle><CardDescription className="text-xs text-slate-600">{t.breakdownHint}</CardDescription></CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 rounded-md border bg-slate-50 p-4 md:grid-cols-4">
          <div><dt className="text-xs text-slate-600">{t.received}</dt><dd className={`mt-1 font-semibold tabular-nums ${tone(totals.received)}`}>{money(totals.received)}</dd>
            <dd className="mt-1 text-xs text-slate-600">{t.payoutSummary(formatInteger(totals.payoutRounds), formatInteger(totals.payouts))}</dd></div>
          <div><dt className="text-xs text-slate-600">{t.purchase}</dt><dd className="mt-1 font-semibold tabular-nums text-red-700">− {money(totals.purchase)}</dd></div>
          <div><dt className="text-xs text-slate-600">{t.activation}</dt><dd className="mt-1 font-semibold tabular-nums text-red-700">− {money(totals.activation)}</dd></div>
          <div><dt className="text-xs text-slate-600">{t.net}</dt><dd className={`mt-1 font-semibold tabular-nums ${tone(totals.net)}`}>= {signed(totals.net)}</dd></div>
        </dl>
      </CardContent>
    </Card>
    {rows.some(row => row.status === "deleted") && <p className="text-xs text-slate-600">{t.historyHint}</p>}
    <PropStatisticsTable rows={rows} />
  </>;
}

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const profileHref = `/users/${encodeURIComponent(userId)}`;
  return <div className="space-y-6">
    <Breadcrumbs items={[{ label: t.profile, href: profileHref }, { label: t.title }]} />
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{t.title}</h1>
      <Button asChild variant="outline"><Link href={profileHref}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t.back}</Link></Button>
    </header>
    <Suspense fallback={<p role="status" className="text-sm text-slate-600">{t.loading}</p>}>
      <Statistics userId={userId} profileHref={profileHref} />
    </Suspense>
  </div>;
}
