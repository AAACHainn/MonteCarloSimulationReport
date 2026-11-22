"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Award, Check, ChevronRight, CircleDot, Info, LockKeyhole } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { achievementCategories, type AchievementKey } from "@/lib/achievements/catalog";
import type { readAchievementDetail, readAchievements } from "@/lib/achievements/read";
import { formatInteger as fmt } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { AchievementBadge, AchievementErrorAlert, achievementDate, achievementRequest, collectionApi, collectionHref, profileHref, t, useAchievementQuery } from "./shared";

type Collection = Awaited<ReturnType<typeof readAchievements>>;
type Series = Collection["items"][number];
type Details = Awaited<ReturnType<typeof readAchievementDetail>>;
const statuses = ["unlocked", "inProgress", "locked"] as const;
const collectionPolling = 8_000;
const statusAppearance = {
  unlocked: { icon: Check, className: "border-positive/25 bg-positive-background text-positive" },
  inProgress: { icon: CircleDot, className: "border-link/25 bg-info-background text-link" },
  locked: { icon: LockKeyhole, className: "border-border bg-background text-secondary-text" },
};

function AchievementStatus({ status, stage }: { status: Series["status"]; stage?: number }) {
  const { icon: Icon, className } = statusAppearance[status];
  return <Badge className={`gap-1.5 px-2 ${className}`}>
    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
    {stage ? `${t[status]} · ${t.tier(fmt(stage))}` : t[status]}
  </Badge>;
}

function StageDetails({ id, item, onClose }: { id: string; item: Series; onClose: () => void }) {
  const query = useAchievementQuery<Details>(`${collectionApi(id)}/${item.key}`, collectionPolling);
  return <Dialog open title={t.names[item.key]} description={t.conditions[item.key]} onClose={onClose}>
    <div className="space-y-4">
      {query.error && <AchievementErrorAlert error={query.error} retry={query.refresh} />}
      {!query.data && !query.error && <p role="status">{t.loading}</p>}
      {item.streak && <p className="text-sm text-secondary-text">{t.streakRule}</p>}
      {item.streak && item.scope && <p className="text-sm text-secondary-text">{item.scope.focused ? t.focusScope : t.scopeBest} · {t.currentScope(item.scope.name, item.scope.round ? fmt(item.scope.round) : "")}</p>}
      {item.gap && <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-background px-3 py-2.5 text-sm leading-relaxed text-secondary-text">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <span>{item.streak ? t.streakHistoryGap : t.historyGap}</span>
      </p>}
      {(item.outdated || item.historyPending) && <p className="text-sm text-secondary-text">{item.outdated ? t.outdated : t.historyPending}</p>}
      <ol className="divide-y rounded-md border bg-card">
        {item.tiers.map((stage, index) => {
          const award = query.data?.find(row => row.tier === stage.key);
          const known = award ?? stage.award;
          return <li key={stage.key} className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong className="font-semibold">{t.tier(fmt(index + 1))}</strong>
                <span className="tabular-nums text-secondary-text">{t.target(fmt(known?.threshold ?? stage.target))}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AchievementStatus status={known ? "unlocked" : "locked"} />
                {known?.historical && <Badge className="bg-background text-secondary-text">{t.historical}</Badge>}
              </div>
            </div>
            {known && <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 [&_dd]:mt-1 [&_dt]:text-xs [&_dt]:text-muted-foreground">
              <div><dt>{t.attainedAt}</dt><dd className="tabular-nums">{known.attainedAt ? achievementDate(known.attainedAt) : t.historicalDateUnknown}</dd></div>
              <div><dt>{t.recordedAt}</dt><dd className="tabular-nums">{achievementDate(known.recordedAt)}</dd></div>
              <div><dt>{t.rule}</dt><dd className="break-words font-mono text-xs">{known.fingerprint}</dd></div>
              {award?.source && <>
                <div><dt>{t.replayAt}</dt><dd className="tabular-nums">{achievementDate(award.source.replayAt)}</dd></div>
                <div className="sm:col-span-2">
                  <dt>{t.source}</dt>
                  <dd className="flex flex-wrap items-center gap-2 break-words">
                    {t.currentScope(award.source.name ?? copy.common.dash, award.source.round ? fmt(award.source.round) : "")}
                    {award.source.symbol && <span>{award.source.symbol}</span>}
                    {award.source.href ? <Button asChild variant="outline"><Link href={award.source.href}>{t.viewSource}</Link></Button> : <span className="text-muted-foreground">{t.unavailableSource}</span>}
                  </dd>
                </div>
              </>}
            </dl>}
          </li>;
        })}
      </ol>
      <p className="text-xs text-muted-foreground">{t.tz}</p>
    </div>
  </Dialog>;
}

function AchievementCard({ item, onDetails }: { item: Series; onDetails: () => void }) {
  const next = item.tiers.find(tier => !tier.award);
  return <Card className="flex min-w-0 flex-col">
    <CardHeader className="flex-row items-start gap-3 space-y-0 pb-3">
      <AchievementBadge id={item.key} level={item.highest} />
      <div className="min-w-0 space-y-2">
        <CardTitle className="leading-snug">{t.names[item.key]}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <AchievementStatus status={item.status} stage={item.tiers.length > 1 ? item.highest : undefined} />
          <span className="text-xs text-secondary-text">{t.categories[item.category]}</span>
        </div>
        <CardDescription className="leading-relaxed text-secondary-text">{t.conditions[item.key]}</CardDescription>
      </div>
    </CardHeader>
    <CardContent className="mt-auto flex items-end gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        {item.streak && <p className="tabular-nums text-xs leading-relaxed text-secondary-text">{item.scope?.focused ? t.focusScope : t.scopeBest} {fmt(item.current)} · {t.historyBest} {fmt(item.best)}</p>}
        {next && <div className="space-y-1.5 pb-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs tabular-nums">
            <span className="text-secondary-text">{t.target(fmt(next.target))}</span>
            <span className="whitespace-nowrap text-sm font-semibold text-foreground">{t.progress(fmt(item.best), fmt(next.target))}</span>
          </div>
          <div role="progressbar" aria-label={t.names[item.key]} aria-valuemin={0} aria-valuemax={next.target} aria-valuenow={Math.min(item.best, next.target)} className="h-1.5 overflow-hidden rounded-md bg-border">
            <div className="h-full rounded-md bg-primary" style={{ width: `${Math.min(100, 100 * item.best / next.target)}%` }} />
          </div>
        </div>}
      </div>
      <Button variant="ghost" className="shrink-0 px-3 text-link" aria-label={`${t.names[item.key]} · ${t.details}`} onClick={onDetails}>
        {t.details}<ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </CardContent>
  </Card>;
}

function Showcase({ collection, onSave }: { collection: Collection; onSave: () => void }) {
  const saved = collection.showcase.map(badge => badge.key).join(",");
  const [selected, setSelected] = useState<AchievementKey[]>(collection.showcase.map(badge => badge.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setSelected(saved ? saved.split(",") as AchievementKey[] : []); }, [saved]);
  const eligible = collection.items.filter(item => item.highest);
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      await achievementRequest(`/api${profileHref(collection.user.id)}/achievement-showcase`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ series: selected }),
      });
      setNotice(t.showcaseSaved); onSave();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.error); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle>{t.showcase}</CardTitle><CardDescription>{t.showcaseHint}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {!eligible.length && <p className="text-sm text-secondary-text">{t.none}</p>}
      <div className="flex flex-wrap gap-2">{eligible.map(item => {
        const index = selected.indexOf(item.key);
        return <Button key={item.key} variant={index < 0 ? "outline" : "secondary"} aria-pressed={index >= 0} disabled={busy || (index < 0 && selected.length >= 3)}
          onClick={() => setSelected(current => current.includes(item.key) ? current.filter(key => key !== item.key) : [...current, item.key])}>
          {index >= 0 && <span className="mr-2 tabular-nums text-secondary-text">{fmt(index + 1)}</span>}{t.names[item.key]}
        </Button>;
      })}</div>
      {error && <AchievementErrorAlert error={error} />}
      {notice && <p role="status" className="text-sm text-positive">{notice}</p>}
      {!!eligible.length && <div className="flex justify-end"><Button disabled={busy || selected.join(",") === saved} onClick={() => void save()}>{busy ? t.admin.pending : t.showcaseSave}</Button></div>}
    </CardContent>
  </Card>;
}

export function AchievementCollection({ userId, focusSession }: { userId: string; focusSession?: string }) {
  const query = useAchievementQuery<Collection>(collectionApi(userId) + (focusSession ? `?session=${encodeURIComponent(focusSession)}` : ""), collectionPolling);
  const [category, setCategory] = useState("all"), [status, setStatus] = useState("all");
  const [detail, setDetail] = useState<AchievementKey>();
  const data = query.data;
  const items = data?.items.filter(item => (category === "all" || item.category === category) && (status === "all" || item.status === status)) ?? [];
  const selected = data?.items.find(item => item.key === detail);
  return <div className="space-y-6">
    <Breadcrumbs items={[{ label: copy.userGrowth.title, href: "/users" }, ...(data ? [{ label: data.user.nickname, href: profileHref(userId) }] : []), { label: t.title }]} />
    <section className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
      <div className="min-w-0 space-y-1">
        {data && <p className="break-words text-sm text-secondary-text">{data.user.nickname}</p>}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t.title}</h1>
        {data && <p className="font-medium tabular-nums text-sm text-secondary-text">{t.stageCount(fmt(data.unlockedStages), fmt(data.totalStages))}</p>}
      </div>
      <Button asChild variant="outline"><Link href={profileHref(userId)}>{t.viewProfile}</Link></Button>
    </section>
    {query.error && <AchievementErrorAlert error={query.error} retry={query.refresh} />}
    {!data && !query.error && <p role="status">{t.loading}</p>}
    {data && <>
      {(data.syncing || data.error) && <p role="status" className="text-sm text-warning">{data.error ? t.queueError : t.syncing}</p>}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-36 space-y-2"><Label htmlFor="achievement-status">{t.status}</Label><Select value={status} onValueChange={setStatus}><SelectTrigger id="achievement-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t.all}</SelectItem>{statuses.map(value => <SelectItem key={value} value={value}>{t[value]}</SelectItem>)}</SelectContent></Select></div>
        <div className="w-36 space-y-2"><Label htmlFor="achievement-category">{t.category}</Label><Select value={category} onValueChange={setCategory}><SelectTrigger id="achievement-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t.all}</SelectItem>{achievementCategories.map(value => <SelectItem key={value} value={value}>{t.categories[value]}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{items.map(item => <AchievementCard key={item.key} item={item} onDetails={() => setDetail(item.key)} />)}</div>
      {!items.length && <p className="rounded-md border border-dashed p-6 text-sm text-secondary-text">{t.noMatches}</p>}
      <Showcase collection={data} onSave={query.refresh} />
    </>}
    {selected && <StageDetails key={selected.key} id={userId} item={selected} onClose={() => setDetail(undefined)} />}
  </div>;
}

export function AchievementProfileSummary({ userId }: { userId: string }) {
  const query = useAchievementQuery<Collection>(collectionApi(userId), collectionPolling);
  const data = query.data;
  return <Card>
    <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
      <div className="space-y-1"><CardTitle className="flex items-center gap-2 leading-snug"><Award className="h-5 w-5 shrink-0 text-link" aria-hidden="true" />{t.title}</CardTitle>
        {data && <CardDescription className="font-medium tabular-nums text-secondary-text">{t.stageCount(fmt(data.unlockedStages), fmt(data.totalStages))}</CardDescription>}
      </div>
      <Button asChild variant="outline"><Link href={collectionHref(userId)}>{t.viewAll}</Link></Button>
    </CardHeader>
    <CardContent className="space-y-3">
      {query.error && <AchievementErrorAlert error={query.error} retry={query.refresh} />}
      {!data && !query.error && <p role="status" className="text-sm text-secondary-text">{t.loading}</p>}
      {data && <p className="text-sm leading-relaxed text-secondary-text">{data.latest ? <>
        {t.latest} · <span className="font-medium text-foreground">{t.names[data.latest.key]}</span> · <span className="tabular-nums">{data.latest.attainedAt ? achievementDate(data.latest.attainedAt) : t.historicalDateUnknown}</span>
      </> : t.none}</p>}
      {!!data?.showcase.length && <ul className="flex flex-wrap gap-2 border-t pt-3">{data.showcase.map(badge => <li key={badge.key}>
        <InfoTooltip label={`${t.names[badge.key]} · ${t.tier(fmt(badge.tier))}`} text={t.conditions[badge.key]}
          className="h-auto min-h-10 border bg-background py-1 pl-1 pr-3">
          <AchievementBadge id={badge.key} level={badge.tier} compact />
          <span>{t.names[badge.key]}</span>
        </InfoTooltip>
      </li>)}</ul>}
    </CardContent>
  </Card>;
}
