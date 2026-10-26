"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { copy } from "@/lib/i18n";
import { defaultPropRules, propRulesSchema, type PropRules } from "@/lib/prop-practice/rules";
import { formatMoney, formatInteger } from "@/lib/format";
const t = copy.propPractice;
export type PropTemplateRow = { id: string; active: boolean; version: number; accountCount: number; versions: { id: string; version: number; rules: string }[] };
type NumericKey = "initialCapital" | "drawdown" | "capOffset" | "target" | "minTradingDays" | "qualifyingDays" | "qualifyingProfit" | "consistency" | "minimum" | "fraction" | "maximum" | "buffer" | "traderShare" | "permanentFloorOffset" | "purchaseCost" | "activationCost";
function flatten(value: object, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, v]) => v !== null && typeof v === "object" ? Object.entries(flatten(v, prefix + key + ".")) : [[prefix + key, v == null ? "" : String(v)]]));
}
function hydrate(base: object, values: Record<string, string>, prefix = ""): object {
  return Object.fromEntries(Object.entries(base).map(([key, v]) => [key, v !== null && typeof v === "object" ? hydrate(v, values, prefix + key + ".")
    : ["name", "description", "mode"].includes(key) ? values[prefix + key] : values[prefix + key] === "" ? null : Number(values[prefix + key])]));
}
export function PropRuleSummary({ rules, currency = "USDT" }: { rules: PropRules; currency?: string }) {
  return <div className="space-y-2 text-xs text-slate-600">
    <p>{t.evaluation}: {t.initialCapital} {formatMoney(rules.evaluation.risk.initialCapital, currency)} · {t.target} {formatMoney(rules.evaluation.target, currency)} · {t.drawdown} {formatMoney(rules.evaluation.risk.drawdown, currency)} · {t[rules.evaluation.risk.mode]}</p>
    <p>{t.funded}: {t.initialCapital} {formatMoney(rules.funded.risk.initialCapital, currency)} · {t.drawdown} {formatMoney(rules.funded.risk.drawdown, currency)} · {t[rules.funded.risk.mode]}</p>
    <p>{t.costs}: {t.purchaseCost} {rules.purchaseCost == null ? copy.common.dash : formatMoney(rules.purchaseCost, currency)} · {t.activationCost} {rules.activationCost == null ? copy.common.dash : formatMoney(rules.activationCost, currency)}</p>
  </div>;
}
export function PropTemplateManager() {
  const [rows, setRows] = useState<PropTemplateRow[]>([]), [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PropTemplateRow | null>(null), [opened, setOpened] = useState(false);
  const [values, setValues] = useState(flatten(defaultPropRules)), [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PropTemplateRow | null>(null), [deleteError, setDeleteError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const editLocked = !!editing && (rows.find(row => row.id === editing.id)?.accountCount ?? 0) > 0;
  async function reload() {
    const response = await fetch("/api/prop-practice-templates", { cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t.requestFailed); setRows(data.templates);
  }
  useEffect(() => { void reload().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  function begin(row?: PropTemplateRow, duplicate = false) {
    if (row && !duplicate && row.accountCount) return;
    const initial: Record<string, string> = { ...flatten(defaultPropRules), ...flatten(row ? JSON.parse(row.versions[0].rules) : defaultPropRules), schemaVersion: String(defaultPropRules.schemaVersion) };
    if (duplicate) initial.name = t.copyTemplateName(initial.name).slice(0, 100);
    setEditing(duplicate ? null : row ?? null); setValues(initial);
    setActive(duplicate ? true : row?.active ?? true); setOpened(true); setError(null); setFieldErrors({}); setSuccess(null);
  }
  function numberField(prefix: string, key: NumericKey, optional = false, signed = false) {
    const path = prefix + key, id = "prop-" + path.replaceAll(".", "-");
    const enabled = values[path] !== "";
    return <div key={path} className="space-y-2">
      <Label htmlFor={id}>{t[key]}{optional ? <span className="ml-2"><input type="checkbox" className="mr-1 focus-visible:ring-2 focus-visible:ring-ring" aria-label={t[key]} checked={enabled} disabled={busy} onChange={e => setValues(v => ({ ...v, [path]: e.target.checked ? ["capOffset", "buffer", "permanentFloorOffset"].includes(key) ? "0" : "1" : "", ...(key === "qualifyingDays" ? { [prefix + "qualifyingProfit"]: e.target.checked ? "1" : "" } : {}) }))} />{t.active}</span> : null}</Label>
      <Input id={id} type="number" step={["consistency", "fraction", "traderShare"].includes(key) ? "any" : key.includes("Days") ? "1" : "0.01"} min={signed ? -1e9 : 0} max={key.includes("Days") ? 10000 : key === "initialCapital" ? 1e12 : 1e9}
        required={!optional} disabled={busy || (optional && !enabled)} value={values[path] ?? ""} aria-invalid={Boolean(fieldErrors[path])} aria-describedby={fieldErrors[path] ? id + "-error" : undefined} onChange={e => setValues(v => ({ ...v, [path]: e.target.value }))} />
      {fieldErrors[path] ? <p id={id + "-error"} className="text-xs text-red-600">{fieldErrors[path]}</p> : null}
    </div>;
  }
  function riskFields(stage: "evaluation" | "funded") {
    const prefix = stage + ".risk.", id = "prop-" + stage + "-mode";
    return <>
      {numberField(prefix, "initialCapital")}{numberField(prefix, "drawdown")}
      <div className="space-y-2"><Label htmlFor={id}>{t.mode}</Label><Select value={values[prefix + "mode"]} disabled={busy} onValueChange={v => setValues(old => ({ ...old, [prefix + "mode"]: v, ...(v === "STATIC" ? { [prefix + "capOffset"]: "" } : {}) }))}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="STATIC">{t.STATIC}</SelectItem><SelectItem value="EOD_BALANCE">{t.EOD_BALANCE}</SelectItem></SelectContent></Select></div>
      {values[prefix + "mode"] === "EOD_BALANCE" ? numberField(prefix, "capOffset", true, true) : null}
    </>;
  }
  async function save() {
    if (busy || editLocked) return;
    setError(null); setFieldErrors({}); setSuccess(null);
    const parsed = propRulesSchema.safeParse(hydrate(defaultPropRules, values));
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map(i => [i.path.join("."), i.code === "custom" && [t.invalidCap, t.invalidMinimum, t.invalidMoneyPrecision].some(message => message === i.message) ? i.message : t.invalidRules])));
      setError(t.invalidRules + " " + [...new Set(parsed.error.issues.map(i => { const key = i.path.at(-1); return key && key in t ? String(t[key as keyof typeof t]) : t.name; }))].join("、")); return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/prop-practice-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing?.id, expectedVersion: editing?.version, active, rules: parsed.data }) });
      const data = await response.json();
      if (!response.ok) { await reload().catch(() => undefined); throw new Error(data.error ?? t.requestFailed); }
      setOpened(false); await reload(); setSuccess(t.saved);
    } catch (e) { setError(e instanceof Error ? e.message : t.requestFailed); } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setDeleteError(null); setSuccess(null);
    try {
      const response = await fetch("/api/prop-practice-templates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleting.id, expectedVersion: deleting.version }) });
      const data = await response.json();
      if (!response.ok) { await reload().catch(() => undefined); throw new Error(data.error ?? t.requestFailed); }
      if (editing?.id === deleting.id) setOpened(false);
      setDeleting(null); await reload(); setSuccess(t.templateDeleted); setError(null);
    } catch (e) { const message = e instanceof Error ? e.message : t.requestFailed; setDeleteError(message); setError(message); } finally { setBusy(false); }
  }
  async function refresh() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await reload(); } catch (e) { setError(e instanceof Error ? e.message : t.requestFailed); } finally { setBusy(false); }
  }
  return <div className="space-y-6" aria-busy={loading || busy}>
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}>{t.retryTemplates}</Button><Button disabled={busy || loading} onClick={() => begin()}>{t.create}</Button></div>
    {error ? <Alert role="alert" className="border-red-200 bg-red-50"><AlertDescription id="prop-template-error">{error}</AlertDescription></Alert> : null}
    {success ? <Alert role="status" aria-live="polite" className="border-emerald-200 bg-emerald-50"><AlertDescription>{success}</AlertDescription></Alert> : null}
    {opened && editLocked ? <Alert className="border-amber-200 bg-amber-50"><AlertDescription>{t.templateInUse}</AlertDescription></Alert> : null}
    {opened ? <form className="space-y-4" aria-describedby={error ? "prop-template-error" : undefined} onSubmit={e => { e.preventDefault(); void save(); }}>
      <Card><CardHeader><CardTitle>{editing ? t.edit : t.create}</CardTitle><CardDescription>{t.templateHint}</CardDescription></CardHeader><CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor="prop-name">{t.name}</Label><Input id="prop-name" required maxLength={100} disabled={busy} value={values.name} onChange={e => setValues(v => ({ ...v, name: e.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="prop-notes">{t.notes}</Label><Textarea id="prop-notes" maxLength={2000} disabled={busy} value={values.description} onChange={e => setValues(v => ({ ...v, description: e.target.value }))} /></div>
        <Label className="flex items-center gap-2" htmlFor="prop-active"><input id="prop-active" type="checkbox" checked={active} disabled={busy} onChange={e => setActive(e.target.checked)} />{t.active}</Label>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{t.costs}</CardTitle><CardDescription>{t.costHint}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{(["purchaseCost", "activationCost"] as const).map(key => <div key={key} className="space-y-2"><Label htmlFor={"prop-" + key}>{t[key]}</Label><Input id={"prop-" + key} type="number" min={0} max={1e9} step="0.01" value={values[key]} disabled={busy} aria-invalid={Boolean(fieldErrors[key])} aria-describedby={fieldErrors[key] ? "prop-" + key + "-error" : undefined} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} />{fieldErrors[key] ? <p id={"prop-" + key + "-error"} className="text-xs text-red-600">{fieldErrors[key]}</p> : null}</div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>{t.evaluation}</CardTitle><CardDescription>{t.optionalHint} {t.consistencyHint}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{riskFields("evaluation")}{numberField("evaluation.", "target")}{numberField("evaluation.", "minTradingDays", true)}{numberField("evaluation.", "consistency", true)}</CardContent></Card>
      <Card><CardHeader><CardTitle>{t.funded}</CardTitle><CardDescription>{t.optionalHint} {t.qualifyingHint}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{riskFields("funded")}{numberField("funded.", "qualifyingDays", true)}{values["funded.qualifyingDays"] !== "" ? numberField("funded.", "qualifyingProfit") : null}{numberField("payout.", "minimum")}{numberField("payout.", "fraction")}{numberField("payout.", "maximum", true)}{numberField("payout.", "buffer", true)}{numberField("payout.", "traderShare")}{numberField("payout.", "permanentFloorOffset", true, true)}</CardContent></Card>
      <p className="text-xs text-slate-500">{t.amountHint}</p>
      <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" type="button" disabled={busy} onClick={() => setOpened(false)}>{copy.common.cancel}</Button><Button type="submit" disabled={busy || editLocked}>{busy ? copy.marketReplay.loading : t.save}</Button></div>
    </form> : null}
    {loading ? <p role="status">{copy.marketReplay.loading}</p> : rows.length ? <div className="grid gap-4 md:grid-cols-2">{rows.map(row => {
      const rules: PropRules = JSON.parse(row.versions[0].rules);
      const locked = row.accountCount > 0, usageId = "template-usage-" + row.id;
      return <Card key={row.id}><CardHeader><CardTitle>{rules.name} <Badge>{row.active ? t.active : t.inactive}</Badge></CardTitle>{rules.description ? <CardDescription>{rules.description}</CardDescription> : null}</CardHeader><CardContent className="space-y-4"><PropRuleSummary rules={rules} /><p id={usageId} className="text-xs text-slate-500">{locked ? t.templateUsage(formatInteger(row.accountCount)) : t.templateUnused}</p><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm" disabled={busy || locked} aria-describedby={usageId} onClick={() => begin(row)}>{t.edit}</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => begin(row, true)}>{t.duplicate}</Button><Button variant="destructive" size="sm" disabled={busy || locked} aria-describedby={usageId} onClick={() => { setDeleting(row); setDeleteError(null); setSuccess(null); }}>{t.deleteTemplate}</Button></div></CardContent></Card>;
    })}</div> : <Card><CardContent className="p-6 text-sm text-slate-600">{t.empty}</CardContent></Card>}
    <ConfirmDialog open={!!deleting} title={t.deleteTemplateTitle} description={deleting ? t.deleteTemplateHint(JSON.parse(deleting.versions[0].rules).name) : ""} confirmLabel={t.deleteTemplate} isLoading={busy} error={deleteError} onCancel={() => { if (!busy) setDeleting(null); }} onConfirm={() => void remove()} />
  </div>;
}
