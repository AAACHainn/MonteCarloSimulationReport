"use client";

import { useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/components/user-growth/user-context";
import { metricKeys, type MetricKey } from "@/lib/achievements/catalog";
import type { readAchievementJob, readAchievementMaintenance } from "@/lib/achievements/read";
import { formatInteger as fmt } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { AchievementErrorAlert, achievementDate, achievementRequest, t, useAchievementQuery } from "./shared";

type Maintenance = Awaited<ReturnType<typeof readAchievementMaintenance>>;
type Job = Maintenance["jobs"][number];
type JobDetail = Awaited<ReturnType<typeof readAchievementJob>>;
const a = t.admin;
const api = "/api/admin/achievements";
const allUsers = "__all__";
const runningStates = ["PREVIEW", "QUEUED", "RUNNING", "DISCARDING"];
const stateText = (key: string) => a.state[key as keyof typeof a.state] ?? key;
const phaseText = (key: string) => a.phase[key as keyof typeof a.phase] ?? key;
const errorText = (key: string) => a.errors[key as keyof typeof a.errors] ?? a.errors.BATCH_FAILED;
const modeText = (key: string) => a.modes[key as keyof typeof a.modes] ?? key;
const scopeText = (userId: string | null, users: { id: string; nickname: string }[]) =>
  userId ? users.find(user => user.id === userId)?.nickname ?? userId : a.allUsers;

function JobDetails({ id, onClose, onAction, onDiscard, busy, actionError }: {
  id: string; onClose: () => void; onAction: (job: Job) => Promise<void>; onDiscard: (id: string) => Promise<void>;
  busy: boolean; actionError: string;
}) {
  const { users } = useCurrentUser();
  const [after, setAfter] = useState<string>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const query = useAchievementQuery<JobDetail>(`${api}/jobs/${encodeURIComponent(id)}${after ? `?after=${encodeURIComponent(after)}` : ""}`, 3_000);
  const job = query.data?.job;
  const canStartOrRetry = job?.status === "READY"
    || (job?.status === "FAILED" && !["PLAN_EXPIRED", "COMMIT_UNVERIFIED"].includes(job.error ?? ""));
  return <Dialog open title={a.progress} onClose={onClose}>
    <div className="space-y-4">
      {query.error && <AchievementErrorAlert error={query.error} retry={query.refresh} />}
      {actionError && <AchievementErrorAlert error={actionError} />}
      {!job && !query.error && <p role="status">{t.loading}</p>}
      {job && <>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[
            [a.range, scopeText(job.userId, users)], [a.mode, modeText(job.mode)], [t.status, stateText(job.status)], [a.stage, phaseText(job.phase)],
            [a.users, fmt(job.users)], [a.processed, fmt(job.processed)], [a.estimated, fmt(job.expectedAwards)], [a.coverage, fmt(job.coverageGaps)],
            [a.published, fmt(job.published)], [a.watermark, fmt(job.liveWatermark)], [a.started, achievementDate(job.createdAt)], [a.updated, achievementDate(job.updatedAt)],
          ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-secondary-text">{label}</dt><dd className="break-words tabular-nums">{value}</dd></div>)}
        </dl>
        <p className="text-sm text-secondary-text">{a.chosenMetrics} · {(JSON.parse(job.metrics) as MetricKey[]).map(metric => t.names[metric]).join("、")}</p>
        {job.status === "READY" && <p role="status" className="text-sm text-secondary-text">{a.ready}</p>}
        {runningStates.includes(job.status) && <p role="status" className="text-sm text-secondary-text">{a.working}</p>}
        {job.error && <AchievementErrorAlert error={errorText(job.error)} />}
        {job.coverageGaps > 0 && <p className="text-sm text-warning">{t.historyGap}</p>}
        {!!query.data?.items.length && <section className="space-y-2">
          <h3 className="text-sm font-semibold">{a.itemList}</h3>
          <ul className="divide-y rounded-md border">{query.data.items.map(item => <li key={item.userId} className="flex flex-wrap justify-between gap-1 px-3 py-2 text-sm">
            <span className="break-all">{scopeText(item.userId, users)}</span><span className="text-secondary-text">{stateText(item.status)} · {phaseText(item.phase)}</span>
          </li>)}</ul>
          {query.data.next && <Button variant="outline" onClick={() => setAfter(query.data?.next ?? undefined)}>{a.itemNext}</Button>}
        </section>}
        {(canStartOrRetry || query.data?.canDiscard) && <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          {query.data?.canDiscard && <Button variant="outline" disabled={busy} onClick={() => setConfirmDiscard(true)}>{a.discard}</Button>}
          {canStartOrRetry && <Button disabled={busy} onClick={async () => { await onAction(job); query.refresh(); }}>{busy ? a.pending : job.status === "FAILED" ? a.retry : job.mode === "RECHECK" ? a.startRecheck : a.start}</Button>}
        </div>}
      </>}
    </div>
    <ConfirmDialog open={confirmDiscard} layerClassName="z-[60]" title={a.discard} description={a.discardDescription}
      confirmLabel={a.discard} confirmDisabled={!query.data?.canDiscard} isLoading={busy} onCancel={() => setConfirmDiscard(false)}
      onConfirm={async () => { await onDiscard(id); setConfirmDiscard(false); query.refresh(); }} />
  </Dialog>;
}

export function AchievementMaintenance() {
  const current = useCurrentUser();
  const [user, setUser] = useState(allUsers);
  const [metrics, setMetrics] = useState<MetricKey[]>(metricKeys);
  const [before, setBefore] = useState<string>();
  const [detail, setDetail] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useAchievementQuery<Maintenance>(api + (before ? `?after=${encodeURIComponent(before)}` : ""), 4_000);
  async function post(url: string, payload: unknown) {
    setBusy(true); setError("");
    try {
      const job = await achievementRequest<Job>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setBefore(undefined); setDetail(job.id); query.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.error); }
    finally { setBusy(false); }
  }
  async function retrySync() {
    setBusy(true); setError("");
    try {
      await achievementRequest(`${api}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      query.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.error); }
    finally { setBusy(false); }
  }
  const preview = (mode: string) => post(`${api}/previews`, { userId: user === allUsers ? null : user, metrics, mode });
  const data = query.data;
  return <div className="space-y-6">
    <Breadcrumbs items={[{ label: a.title, href: "/admin" }, { label: a.achievements }]} />
    <section className="border-b pb-6">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{a.achievements}</h1>
      <p className="mt-2 text-sm text-secondary-text">{a.summary}</p>
    </section>
    {query.error && <AchievementErrorAlert error={query.error} retry={query.refresh} />}
    {error && !detail && <AchievementErrorAlert error={error} />}
    {!data && !query.error && <p role="status">{t.loading}</p>}
    {data && <>
      <Card><CardContent className="space-y-4 p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-secondary-text">{a.version}</dt><dd>{data.version}</dd></div>
          <div><dt className="text-secondary-text">{a.capturedAt}</dt><dd>{achievementDate(data.slot.enabledAt)}</dd></div>
          <div><dt className="text-secondary-text">{a.lastSync}</dt><dd>{achievementDate(data.slot.lastSyncedAt)}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">{(["PREVIEW", "READY", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const).map(status => <Badge key={status}>{stateText(status)} · {fmt(data.counts[status] ?? 0)}</Badge>)}</div>
        {data.slot.liveError && <div className="space-y-2">
          <AchievementErrorAlert error={errorText(data.slot.liveError)} />
          {data.slot.liveError !== "COMMIT_UNVERIFIED" && <Button variant="outline" disabled={busy} onClick={() => void retrySync()}>{busy ? a.pending : a.retrySync}</Button>}
        </div>}
      </CardContent></Card>
      <Card>
        <CardHeader><CardTitle>{a.preview}</CardTitle><CardDescription>{a.working}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-80 space-y-2">
            <Label htmlFor="achievement-user">{a.range}</Label>
            <Select value={user} onValueChange={setUser}>
              <SelectTrigger id="achievement-user"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={allUsers}>{a.allUsers}</SelectItem>{current.users.map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.nickname}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{a.chosenMetrics}</legend>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" aria-pressed={metrics.length === metricKeys.length} onClick={() => setMetrics(metricKeys)}>{a.allMetrics}</Button>
              {metricKeys.map(metric => <Button key={metric} variant={metrics.includes(metric) ? "secondary" : "outline"} aria-pressed={metrics.includes(metric)} onClick={() => setMetrics(items => items.includes(metric) ? items.filter(key => key !== metric) : [...items, metric])}>{t.names[metric]}</Button>)}
            </div>
          </fieldset>
          {!metrics.length && <p className="text-sm text-warning">{a.noneSelected}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <Button variant="outline" disabled={busy || !metrics.length} onClick={() => void preview("RECHECK")}>{a.recheck}</Button>
            <Button disabled={busy || !metrics.length} onClick={() => void preview("BACKFILL")}>{busy ? a.pending : a.preview}</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{a.progress}</CardTitle></CardHeader>
        <CardContent>
          {data.jobs.length ? <Table>
            <TableHeader><TableRow><TableHead>{a.range}</TableHead><TableHead>{a.mode}</TableHead><TableHead>{t.status}</TableHead><TableHead>{a.stage}</TableHead><TableHead>{a.updated}</TableHead><TableHead className="text-right">{a.actions}</TableHead></TableRow></TableHeader>
            <TableBody>{data.jobs.map(job => <TableRow key={job.id}>
              <TableCell className="break-all">{scopeText(job.userId, current.users)}</TableCell><TableCell>{modeText(job.mode)}</TableCell>
              <TableCell>{stateText(job.status)}</TableCell><TableCell>{phaseText(job.phase)}</TableCell><TableCell className="tabular-nums">{achievementDate(job.updatedAt)}</TableCell>
              <TableCell className="text-right"><Button variant="ghost" onClick={() => { setError(""); setDetail(job.id); }}>{t.details}</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table> : <p className="rounded-md border border-dashed p-6 text-sm text-secondary-text">{a.empty}</p>}
          {(before || data.next) && <div className="mt-4 flex justify-end gap-2">
            {before && <Button variant="outline" onClick={() => setBefore(undefined)}>{a.latest}</Button>}
            {data.next && <Button variant="outline" onClick={() => setBefore(data.next ?? undefined)}>{a.next}</Button>}
          </div>}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t.tz} · {copy.achievements.historyGap}</p>
    </>}
    {detail && <JobDetails key={detail} id={detail} onClose={() => { setDetail(undefined); setError(""); }} busy={busy} actionError={error}
      onDiscard={id => post(`${api}/jobs/${encodeURIComponent(id)}/discard`, {})} onAction={job =>
      job.status === "FAILED" ? post(`${api}/jobs/${encodeURIComponent(job.id)}/retry`, {}) : post(`${api}/jobs`, { planId: job.id })} />}
  </div>;
}
