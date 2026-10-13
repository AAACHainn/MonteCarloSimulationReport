"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { copy } from "@/lib/i18n";
import { NATIVE_INTERVALS, type SyncConfigView, type SyncSettings, type SyncRunView } from "@/lib/market-sync/types";
import { nextScheduledAt } from "@/lib/market-sync/schedule";
import type { MarketDatasetSummary } from "@/lib/market-replay/types";

const c = copy.marketSync;
async function jsonRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? c.failed); return result;
}
function time(value: string | null | undefined, timezone: string) { return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : copy.common.dash; }
function Choice({ id, label, value, options, onChange, disabled }: { id: string; label: string; value: string; options: Record<string, string>; onChange: (value: string) => void; disabled?: boolean }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(options).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>;
}
function Feedback({ error, children }: { error?: boolean; children: React.ReactNode }) { return <Alert role={error ? "alert" : "status"} aria-live="polite" className={error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}><AlertDescription>{children}</AlertDescription></Alert>; }
type Connection = { configured: boolean; encryptionReady: boolean; suffix: string | null; status: string; error: string | null };
export function MarketDataConnectionControl() {
  const [open, setOpen] = useState(false); const [key, setKey] = useState(""); const [connection, setConnection] = useState<Connection | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setNotice(null); void jsonRequest<Connection>("/api/market-data/connections/databento").then((value) => { setConnection(value); setError(value.error); }).catch((error) => setError(error.message)); } }, [open]);
  const close = () => { if (!busy) { setOpen(false); setKey(""); } };
  async function execute(test: boolean) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await jsonRequest<Connection>(`/api/market-data/connections/databento${test ? "/test" : ""}`, test ? "POST" : "PUT", test ? undefined : { apiKey: key });
      setConnection(result); setKey(""); if (result.error) setError(result.error); else setNotice(test ? c.connected : c.saved);
    } catch (error) { setError(error instanceof Error ? error.message : c.failed); }
    finally { setBusy(false); }
  }
  return <><Button type="button" variant="outline" onClick={() => setOpen(true)}><KeyRound className="h-4 w-4" />{c.connection}</Button><Dialog open={open} title={c.connectionTitle} onClose={close}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void execute(false); }}>
      <p className="text-sm">{connection?.configured ? `••••${connection.suffix} · ${connection.status === "CONNECTED" ? c.connected : c.untested}` : c.unconfigured}</p>
      {connection && !connection.encryptionReady ? <Feedback error>{c.masterMissing}</Feedback> : null}
      <div className="space-y-2"><Label htmlFor="databento-key">{c.key}</Label><Input id="databento-key" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={key} onChange={(event) => setKey(event.target.value)} disabled={busy || !connection?.encryptionReady} aria-describedby="databento-key-hint" /><p id="databento-key-hint" className="text-xs text-slate-500">{c.keyHint}</p></div>
      {error ? <Feedback error>{error}</Feedback> : notice ? <Feedback>{notice}</Feedback> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy || !connection?.configured || !connection.encryptionReady} onClick={() => void execute(true)}>{c.test}</Button><Button type="button" variant="outline" onClick={close} disabled={busy}>{c.cancel}</Button><Button type="submit" disabled={busy || !key || !connection?.encryptionReady}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{c.saveKey}</Button></div>
    </form>
  </Dialog></>;
}
export function MarketSyncSummary({ dataset }: { dataset: MarketDatasetSummary }) {
  const router = useRouter(); const [view, setView] = useState<SyncConfigView | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [history, setHistory] = useState<SyncRunView[] | null>(null);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let completed: string | null = null; let initialized = false; let pending = false;
    const poll = async () => {
      if (pending || stopped) return;
      pending = true;
      try {
        const next = await jsonRequest<SyncConfigView>(`/api/market-datasets/${dataset.id}/sync-config`);
        if (stopped) return; setView(next);
        if (next.latestRun?.status === "COMPLETED" && next.latestRun.id !== completed) { if (initialized) router.refresh(); completed = next.latestRun.id; }
        initialized = true;
        timer = setTimeout(() => void poll(), next.active ? 2000 : 15000);
      } catch { if (!stopped) timer = setTimeout(() => void poll(), 15000); }
      finally { pending = false; }
    };
    const settingsSaved = (event: Event) => { if ((event as CustomEvent<string>).detail === dataset.id) { clearTimeout(timer); void poll(); } };
    window.addEventListener("market-sync-settings-saved", settingsSaved);
    void poll(); return () => { stopped = true; clearTimeout(timer); window.removeEventListener("market-sync-settings-saved", settingsSaved); };
  }, [dataset.id, router]);
  async function sync() {
    setBusy(true); setError(null);
    try { await jsonRequest(`/api/market-datasets/${dataset.id}/sync`, "POST"); setView(await jsonRequest<SyncConfigView>(`/api/market-datasets/${dataset.id}/sync-config`)); }
    catch (error) { setError(error instanceof Error ? error.message : c.failed); }
    finally { setBusy(false); }
  }
  const latest = view?.latestRun;
  return <div className="space-y-2 border-t pt-3 text-xs text-slate-600">
    <p>{c.mode}：{c.modes[view?.mode ?? "OFF"]}{view && view.mode !== "OFF" ? ` · ${c.source}：Databento · ${view.profile.root}` : ""}</p>
    {view && view.mode !== "OFF" ? <><p className="tabular-nums">{c.checked}：{time(view.lastCheckedAt, view.schedule.timezone)} · {c.next}：{time(view.nextRunAt, view.schedule.timezone)}（{view.schedule.timezone}）</p><p className="tabular-nums">{c.dataThrough}：{time(dataset.endTime, dataset.timezone)} · {c.available}：{time(view.availableThrough, dataset.timezone)}（{dataset.timezone}）</p>
      {latest ? <p role="status" aria-live="polite" className={latest.error ? "text-red-700" : "text-slate-700"}>{latest.error ?? (latest.status === "COMPLETED" ? latest.addedBars ? c.count(latest.addedBars) : c.noNew : c.stages[latest.stage as keyof typeof c.stages] ?? c.statuses[latest.status as keyof typeof c.statuses])}</p> : null}
      <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-0" disabled={busy || view.active} onClick={() => void sync()}>{busy || view.active ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{busy || view.active ? c.syncing : view.pausedReason === c.conflict ? c.retry : c.sync}</Button><Button type="button" variant="ghost" size="sm" onClick={() => { setError(null); void jsonRequest<SyncRunView[]>(`/api/market-datasets/${dataset.id}/sync-runs`).then(setHistory).catch((error) => setError(error.message)); }}>{c.taskHistory}</Button></div>
    </> : null}
    {error ? <Feedback error>{error}</Feedback> : null}
    <Dialog open={history !== null} title={c.taskHistory} onClose={() => setHistory(null)}><div className="space-y-3">{history?.length === 0 ? <p className="text-sm text-slate-500">{c.noRuns}</p> : null}{history?.map((run) => <div className="space-y-2 rounded-md border p-3" key={run.id}><p className="text-sm tabular-nums">{time(run.updatedAt, dataset.timezone)} · {c.statuses[run.status as keyof typeof c.statuses]} · {c.count(run.addedBars)}</p><p className="text-sm text-red-700">{run.error}</p>{run.conflicts !== "[]" ? <><p className="text-sm font-medium">{c.conflicts}</p><pre className="overflow-x-auto text-xs">{JSON.stringify(JSON.parse(run.conflicts), null, 2)}</pre></> : null}</div>)}</div></Dialog>
  </div>;
}
export function MarketSyncSettings({ dataset, onBusyChange, onCancel }: { dataset: MarketDatasetSummary; onBusyChange?: (value: boolean) => void; onCancel?: () => void }) {
  const [settings, setSettings] = useState<SyncSettings | null>(null); const [active, setActive] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { let stopped = false; void jsonRequest<SyncConfigView>(`/api/market-datasets/${dataset.id}/sync-config`).then((value) => { if (!stopped) { setSettings({ ...value, profile: { ...value.profile, root: value.profile.root.replace(/[^A-Z0-9]/g, ""), interval: NATIVE_INTERVALS.includes(value.profile.interval as typeof NATIVE_INTERVALS[number]) ? value.profile.interval : 60 } }); setActive(value.active); } }).catch((error) => { if (!stopped) setError(error.message); }); return () => { stopped = true; }; }, [dataset.id]);
  const patch = (value: Partial<SyncSettings>) => { setSettings((current) => current ? { ...current, ...value } : current); setNotice(null); };
  const profile = (value: Partial<SyncSettings["profile"]>) => settings && patch({ profile: { ...settings.profile, ...value } });
  const schedule = (value: Partial<SyncSettings["schedule"]>) => settings && patch({ schedule: { ...settings.schedule, ...value } });
  let next: string | null = null;
  try { if (settings?.mode === "AUTO") next = nextScheduledAt(settings.schedule, new Date()).toISOString(); } catch { /* Invalid draft values are validated on save. */ }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!settings) return; setBusy(true); onBusyChange?.(true); setError(null);
    try { const saved = await jsonRequest<SyncConfigView>(`/api/market-datasets/${dataset.id}/sync-config`, "PUT", settings); setSettings(saved); setNotice(c.syncSuccess); window.dispatchEvent(new CustomEvent("market-sync-settings-saved", { detail: dataset.id })); }
    catch (error) { setError(error instanceof Error ? error.message : c.failed); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <section className="space-y-4 border-t pt-4"><h3 className="text-base font-semibold">{c.settings}</h3>{settings ? <form className="space-y-4" onSubmit={(event) => void save(event)}>
    <Choice id="sync-mode" label={c.mode} value={settings.mode} options={c.modes} onChange={(value) => patch({ mode: value as SyncSettings["mode"] })} disabled={busy} />
    {settings.mode !== "OFF" ? <><p className="text-xs text-slate-500">{c.frequencyHint}</p><div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="sync-root">{c.root}</Label><Input id="sync-root" value={settings.profile.root} onChange={(event) => profile({ root: event.target.value.toUpperCase() })} required disabled={active || busy} /></div>
      <Choice id="sync-contract-mode" label={c.contractMode} value={settings.profile.contractMode} options={{ CONTINUOUS: c.continuous, OUTRIGHT: c.outright }} onChange={(value) => profile({ contractMode: value as SyncSettings["profile"]["contractMode"] })} disabled={active || busy} />
      {settings.profile.contractMode === "OUTRIGHT" ? <div className="space-y-2"><Label htmlFor="sync-contract">{c.contract}</Label><Input id="sync-contract" value={settings.profile.contract} onChange={(event) => profile({ contract: event.target.value.toUpperCase() })} required disabled={active || busy} /></div> : null}
      <div className="space-y-2"><Label htmlFor="sync-interval">{c.interval}</Label><Input id="sync-interval" value={dataset.sourceIntervalSeconds ?? ""} readOnly /><p className="text-xs text-slate-500">{NATIVE_INTERVALS.includes(dataset.sourceIntervalSeconds as typeof NATIVE_INTERVALS[number]) ? c.source + "：Databento / CME" : c.unsupported}</p></div>
      <div className="space-y-2"><Label htmlFor="sync-run-budget">{c.runBudget}</Label><Input id="sync-run-budget" type="number" min="0" step="any" required value={Number.isFinite(settings.perRunBudget) ? settings.perRunBudget : String()} onChange={(event) => patch({ perRunBudget: event.target.value === "" ? NaN : Number(event.target.value) })} disabled={busy} /></div>
      <div className="space-y-2"><Label htmlFor="sync-day-budget">{c.dailyBudget}</Label><Input id="sync-day-budget" type="number" min="0" step="any" required value={Number.isFinite(settings.dailyBudget) ? settings.dailyBudget : String()} onChange={(event) => patch({ dailyBudget: event.target.value === "" ? NaN : Number(event.target.value) })} disabled={busy} /></div>
      <div className="space-y-2"><Label htmlFor="sync-timezone">{c.timezone}</Label><Input id="sync-timezone" value={settings.schedule.timezone} onChange={(event) => schedule({ timezone: event.target.value })} required disabled={busy} /></div>
    </div><p className="text-xs text-slate-500">{c.budgetHint}</p>
    {settings.mode === "AUTO" ? <div className="space-y-4 rounded-md border p-3"><div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="sync-every">{c.every}</Label><Input id="sync-every" type="number" min="1" max="1000" step="1" required value={settings.schedule.every} onChange={(event) => schedule({ every: Number(event.target.value) })} /></div>
      <Choice id="sync-unit" label={c.frequency} value={settings.schedule.unit} options={c.units} onChange={(value) => schedule({ unit: value as SyncSettings["schedule"]["unit"] })} />
      {["DAY", "WEEK", "MONTH"].includes(settings.schedule.unit) ? <div className="space-y-2"><Label htmlFor="sync-time">{c.time}</Label><Input id="sync-time" type="time" value={settings.schedule.time} onChange={(event) => schedule({ time: event.target.value })} required /></div> : null}
      {settings.schedule.unit === "WEEK" ? <Choice id="sync-weekday" label={c.weekdayLabel} value={String(settings.schedule.weekday)} options={c.weekdays} onChange={(value) => schedule({ weekday: Number(value) })} /> : null}
      {settings.schedule.unit === "MONTH" ? <div className="space-y-2"><Label htmlFor="sync-month-day">{c.monthDay}</Label><Input id="sync-month-day" type="number" min="1" max="31" step="1" value={settings.schedule.monthDay} onChange={(event) => schedule({ monthDay: Number(event.target.value) })} disabled={settings.schedule.monthEnd} required /></div> : null}
    </div>{settings.schedule.unit === "MONTH" ? <><CheckboxField checked={settings.schedule.monthEnd} onChange={(value) => schedule({ monthEnd: value })}>{c.monthEnd}</CheckboxField><p className="text-xs text-slate-500">{c.monthHint}</p></> : null}<p className="text-xs tabular-nums">{c.next}：{next ? time(next, settings.schedule.timezone) : copy.common.dash}（{settings.schedule.timezone}）</p></div> : null}</> : null}
    {active ? <p className="text-xs text-amber-800">{c.busy}</p> : null}{error ? <Feedback error>{error}</Feedback> : notice ? <Feedback>{notice}</Feedback> : null}
    <div className="flex justify-end gap-2 border-t pt-4">{onCancel ? <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{c.cancel}</Button> : null}<Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{c.save}</Button></div>
  </form> : error ? <Feedback error>{error}</Feedback> : <Loader2 className="h-4 w-4 animate-spin" />}</section>;
}
