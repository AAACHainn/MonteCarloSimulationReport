"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copy } from "@/lib/i18n";
import { formatInteger, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GrowthProfile, GrowthRecord, ProfileSession, QueryState, UserIdentity } from "@/lib/user-growth/types";
import { UserAvatar } from "./user-avatar";
import { GrowthRecordList } from "./growth-record-list";
import styles from "./user-growth.module.css";

const t = copy.userGrowth;
const fmt = formatInteger;
export function sessionEligibility(session: ProfileSession) {
  return session.eligibility === "growth" ? t.growthSession : session.eligibility === "unassigned" ? t.unownedHint : t.replayExcluded;
}

function RealmTrack({ profile }: { profile: GrowthProfile }) {
  return <div className="mt-7 border-t border-slate-200 pt-5">
    <div className={styles.track} aria-hidden="true"><span className={cn("text-sm", profile.realm === "mortal" ? styles.jade : "text-slate-600")}>{t.mortal}</span>
      <div><div className="mb-2 flex justify-between text-sm"><span className={styles.jade}>{t.qi}</span><span className={styles.jade}>{profile.realm === "qi" ? profile.user.realmLabel : ""}</span></div><div className={styles.ticks}>{t.layerNames.map((name, i) => <span key={name} className={cn(styles.tick, (profile.realm === "foundation" || (profile.realm === "qi" && i < profile.layer)) && styles.tickActive)} />)}</div></div>
      <span className={cn("text-sm", profile.realm === "foundation" ? styles.jade : "text-slate-600")}>{t.foundation}</span>
    </div><p className="mt-3 text-xs text-slate-600">{profile.realm === "qi" ? t.trackHint(t.layerNames[profile.layer - 1]) : profile.realm === "foundation" ? t.trackFoundation : t.trackMortal} <span className="ml-2">{t.future}</span></p>
  </div>;
}

export function ProfileView({ profile, selected, state, onRetry, onSwitch, onEdit, onBreakthrough, breaking, actionError, onOpenSession, onSource, onAllRecords }: {
  profile: GrowthProfile; selected?: UserIdentity; state: QueryState; onRetry: () => void; onSwitch: () => void; onEdit: () => void;
  onBreakthrough: () => Promise<boolean>; breaking: boolean; actionError: string; onOpenSession: (session: ProfileSession) => void; onSource: (record: GrowthRecord) => void; onAllRecords: () => void;
}) {
  const [conditionsOpen, setConditionsOpen] = useState(profile.realm === "qi");
  const realmRef = useRef<HTMLHeadingElement>(null);
  const satisfied = profile.conditions.filter((c) => c.value >= c.target).length;
  const ready = satisfied === 6 && profile.realm !== "foundation";
  const xpCondition = profile.conditions[0];
  const xpMet = !!xpCondition && xpCondition.value >= xpCondition.target;
  const segment = profile.segment;
  const breakthrough = async () => { if (await onBreakthrough()) { setConditionsOpen(false); requestAnimationFrame(() => realmRef.current?.focus()); } };
  return <div className={cn(styles.theme, "space-y-6")} aria-busy={state === "loading"}>
    <section className={cn(styles.identity, "overflow-hidden rounded-lg border px-6 pb-6 pt-7", profile.realm === "foundation" && styles.breakthrough)} aria-label={t.realm}>
      <svg viewBox="0 0 380 100" className={styles.mountains} fill="none" aria-hidden="true"><path d="M0 99 60 55 85 71 142 12 195 77 237 46 287 82 330 34 380 99M67 99 142 36 182 82 203 70 230 99" stroke="currentColor" strokeWidth="1" /></svg>
      <div className="relative flex flex-wrap items-start gap-5">
        <UserAvatar avatar={profile.user.avatar} size="profile" />
        <div className="min-w-0 flex-1 basis-72"><p className="mb-2 text-xs text-slate-600">{t.viewing}</p><h1 className="break-words text-3xl font-semibold tracking-tight text-slate-950">{profile.user.nickname}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3"><h2 ref={realmRef} tabIndex={-1} className={cn(styles.realm, "rounded-sm text-2xl font-semibold focus-visible:ring-2 focus-visible:ring-ring")}>{profile.user.realmLabel}</h2>
            {profile.realm === "foundation" || ready ? <Badge className={cn(styles.gold, "gap-1 border-current")}><Sparkles className="h-3 w-3" aria-hidden="true" />{profile.realm === "foundation" ? t.achieved : t.ready}</Badge> : profile.layer === 12 ? <span className="text-sm text-slate-600">{xpMet ? t.experienceMet : t.preparing}</span> : null}
          </div><p className="mt-3 text-sm text-slate-700">{t.totalXp}<strong className="ml-3 font-mono text-lg tabular-nums text-slate-950">{fmt(profile.totalXp)}</strong>{profile.growthPending && <span className="ml-3 text-xs text-slate-600">{t.growthPending}</span>}</p>
        </div>
        <div className="flex flex-col items-end gap-3"><Button variant="ghost" onClick={onEdit} disabled={breaking}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />{t.edit}</Button>
          {ready && <Button onClick={breakthrough} disabled={breaking || state !== "normal"}>{breaking && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{breaking ? t.breaking : t.breakthrough}</Button>}
        </div>
      </div>
      {selected?.id !== profile.user.id && <div className="relative mt-5 flex flex-wrap items-center gap-2 border-t pt-3 text-sm text-slate-700"><span>{t.selection}：{selected?.nickname ?? t.all}</span><Button variant="ghost" onClick={onSwitch}>{t.switchTo(profile.user.nickname)}</Button></div>}
      <div className="relative mt-5 max-w-3xl">
        {profile.growthPending ? <p className="text-sm text-slate-600">{t.growthPending}</p> : segment ? <><div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><span>{t.segmentXp} <strong className="ml-2 font-mono tabular-nums">{fmt(segment.value)} / {fmt(segment.max)}</strong></span><span className="text-slate-700">{segment.value >= segment.max ? t.experienceMet : t.remainingXp(fmt(segment.max - segment.value))}</span></div>
          <div role="progressbar" aria-label={t.segmentXp} aria-valuemin={0} aria-valuemax={segment.max} aria-valuenow={Math.min(segment.value, segment.max)} aria-valuetext={`${fmt(segment.value)} / ${fmt(segment.max)} ${t.xp}`} className={cn(styles.progress, "h-1.5 overflow-hidden rounded-full")}><div className={cn(styles.bar, "h-full rounded-full")} style={{ width: `${Math.min(100, segment.value / segment.max * 100)}%` }} /></div>
          <p className="mt-3 text-sm text-slate-700">{profile.realm === "mortal" ? t.nextMortal : t.nextLayer(segment.next)}</p>{profile.realm === "mortal" && <p className="mt-2 text-sm leading-6 text-slate-600">{t.mortalHint}</p>}
        </> : <><p className="text-sm text-slate-700">{t.foundationHint}</p><p className="mt-2 text-xs text-slate-600">{profile.attainedAt ? t.reached(profile.attainedAt) : copy.common.dash}</p></>}
        <RealmTrack profile={profile} />
      </div>
    </section>
    {actionError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
    {state !== "normal" && <div role={state === "error" ? "alert" : "status"} className="flex items-center justify-between gap-3 rounded-md border bg-white p-3 text-sm text-slate-700"><span>{state === "loading" ? profile.growthPending ? t.loadingProfile : t.loadingHint : profile.growthPending ? t.profileStale : t.stale}</span>{state === "error" && <Button variant="outline" onClick={onRetry}>{t.retry}</Button>}</div>}
    {profile.growthPending ? <Card className="shadow-none"><CardHeader><CardTitle>{t.growthPending}</CardTitle><CardDescription>{t.growthPendingHint}</CardDescription></CardHeader></Card> : <div className="space-y-6">
      <Card className="min-w-0 shadow-none"><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{t.conditions}</CardTitle><span className={cn("text-sm", profile.realm === "foundation" ? styles.jade : "text-slate-600")}>{profile.realm === "foundation" ? t.achieved : t.conditionCount(fmt(satisfied))}</span></div><CardDescription>{t.conditionsHint}</CardDescription></CardHeader>
        <CardContent><Button variant="ghost" className="mb-3 w-full justify-between" onClick={() => setConditionsOpen(!conditionsOpen)} aria-expanded={conditionsOpen} aria-controls="growth-conditions">{conditionsOpen ? t.hideConditions : t.showConditions}<ChevronDown className={cn("h-4 w-4", conditionsOpen && "rotate-180")} aria-hidden="true" /></Button>
          {conditionsOpen && <div id="growth-conditions">{[t.practice, t.prop].map((group, groupIndex) => <section key={group} className="mb-5"><h3 className="border-b pb-3 text-xs font-semibold tracking-wider text-slate-600">{group}</h3><div className="divide-y">{profile.conditions.slice(groupIndex * 3, groupIndex * 3 + 3).map((c, index) => {
            const i = groupIndex * 3 + index; const done = c.value >= c.target; const number = i === 5 ? formatNumber : fmt;
            return <div key={i} className={cn(styles.condition, "py-4 text-sm")}><span className="text-slate-700">{t.metricLabels[i]}</span><span className="whitespace-nowrap text-right font-mono tabular-nums text-slate-950">{number(c.value)}<span className="text-slate-500"> / {number(c.target)}</span></span><span className={cn("flex items-center justify-end gap-1 text-sm", done ? "text-emerald-700" : "text-slate-600")}>{done && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}{done ? t.satisfied : t.shortOf(number(c.target - c.value), t.units[i])}</span></div>;
          })}</div></section>)}<p className="text-xs leading-6 text-slate-600">{t.conditionsFoot}</p></div>}
        </CardContent>
      </Card>
      <Card className="min-w-0 shadow-none"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t.records}</CardTitle><span className="text-sm tabular-nums text-slate-600">{t.recordCount(fmt(profile.recordCount))}</span></div><CardDescription>{t.recentRecordsHint} · {t.settlementTime}</CardDescription></CardHeader><CardContent>
        <GrowthRecordList records={profile.records.slice(0, 5)} onSource={onSource} />
        {profile.recordCount > 5 && <div className="mt-5 flex justify-end border-t pt-4"><Button variant="outline" onClick={onAllRecords}>{t.allRecords}</Button></div>}
      </CardContent></Card>
    </div>}
    <section className="rounded-lg" aria-label={t.sessions}><Card className="shadow-none"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t.sessions}</CardTitle></div><CardDescription>{t.sessionsHint}</CardDescription></CardHeader><CardContent>{profile.sessions.length ? <Table><TableHeader><TableRow><TableHead>{t.sessionName}</TableHead><TableHead>{t.mode}</TableHead><TableHead>{t.account}</TableHead><TableHead>{t.eligibility}</TableHead><TableHead className="text-right">{t.trades}</TableHead><TableHead><span className="sr-only">{t.openSession}</span></TableHead></TableRow></TableHeader><TableBody>{profile.sessions.map((session) => <TableRow key={session.id}><TableCell className="min-w-36"><strong className="font-medium">{session.name}</strong><p className="mt-1 text-xs text-slate-500">{session.market}</p></TableCell><TableCell className="whitespace-nowrap">{session.mode === "training" ? t.training : t.replay}</TableCell><TableCell className="whitespace-nowrap">{session.account === "default" ? t.defaultAccount : t.propAccount}</TableCell><TableCell className="min-w-40"><Badge className={session.eligibility === "growth" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"}>{profile.growthPending && session.eligibility === "growth" ? t.eligibilityReserved : sessionEligibility(session)}</Badge></TableCell><TableCell className="text-right tabular-nums">{fmt(session.trades)}</TableCell><TableCell><Button variant="ghost" className="whitespace-nowrap text-blue-700" onClick={() => onOpenSession(session)}>{t.openSession}</Button></TableCell></TableRow>)}</TableBody></Table> : <p className="rounded-md border border-dashed p-6 text-sm text-slate-600">{profile.growthPending ? t.realSessionEmpty : t.sessionEmpty}</p>}</CardContent></Card></section>
  </div>;
}
