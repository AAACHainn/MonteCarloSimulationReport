"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/i18n";
import type { StrategyChecklistItem } from "@/lib/paper-trading/training-gate";

export type ManagedStrategy = { id: string; name: string; active: boolean; checklist: StrategyChecklistItem[]; checklistVersion: number };
export function StrategyManager({ options }: { options: ManagedStrategy[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ManagedStrategy | "NEW" | null>(null);
  const [deleting, setDeleting] = useState<ManagedStrategy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function mutate(id: string, method: string, body?: unknown) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/trade-options/${id}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : copy.trainingGate.failed);
      setDeleting(null); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : copy.trainingGate.failed); }
    finally { setBusy(false); }
  }
  return <>
    <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{copy.masterData.options.strategies.title}</CardTitle><CardDescription className="mt-2">{copy.trainingGate.checklistHint}</CardDescription></div><Button onClick={() => setEditing("NEW")} disabled={busy}><Plus className="h-4 w-4" />{copy.trainingGate.addStrategy}</Button></div></CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        {!options.length ? <p className="rounded-md border border-dashed p-6 text-sm text-slate-500">{copy.masterData.options.strategies.empty}</p> : options.map((option) => <div key={option.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{option.name}</p><p className={`mt-1 text-xs ${option.checklist.length ? "text-slate-500" : "text-amber-800"}`}>{option.checklist.length ? copy.trainingGate.checklistCount(option.checklist.length) : copy.trainingGate.emptyChecklist}</p></div>
          {!option.active ? <Badge>{copy.trainingGate.inactive}</Badge> : null}
          <Button variant="outline" disabled={busy} onClick={() => setEditing(option)} aria-label={`${copy.trainingGate.editStrategy} ${option.name}`}><Pencil className="h-4 w-4" />{copy.masterData.options.edit}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void mutate(option.id, "PATCH", { active: !option.active })}>{option.active ? copy.masterData.options.deactivate : copy.masterData.options.reactivate}</Button>
          <Button variant="ghost" size="icon" disabled={busy} onClick={() => setDeleting(option)} aria-label={`${copy.masterData.options.delete} ${option.name}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
        </div>)}
      </CardContent>
    </Card>
    {editing ? <StrategyEditor key={editing === "NEW" ? "NEW" : editing.id} strategy={editing === "NEW" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} /> : null}
    <ConfirmDialog open={Boolean(deleting)} title={copy.masterData.options.deleteTitle} description={copy.masterData.options.deleteConfirm} confirmLabel={copy.masterData.options.delete} isLoading={busy} onCancel={() => { if (!busy) setDeleting(null); }} onConfirm={() => { if (deleting) void mutate(deleting.id, "DELETE"); }} />
  </>;
}
function StrategyEditor({ strategy, onClose, onSaved }: { strategy: ManagedStrategy | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(strategy?.name ?? "");
  const [checklist, setChecklist] = useState(strategy?.checklist ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function move(index: number, to: number) { const next = [...checklist]; [next[index], next[to]] = [next[to], next[index]]; setChecklist(next); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    const items = checklist.map((item) => ({ ...item, text: item.text.trim() }));
    if (items.some((item) => !item.text) || new Set(items.map((item) => item.text)).size !== items.length) { setError(copy.trainingGate.itemRequired); return; }
    setBusy(true);
    try {
      const response = await fetch(strategy ? `/api/trade-options/${strategy.id}` : "/api/trade-options", { method: strategy ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), checklist: items, ...(strategy ? { checklistVersion: strategy.checklistVersion } : { type: "STRATEGY" }) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : copy.trainingGate.failed);
      onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : copy.trainingGate.failed); }
    finally { setBusy(false); }
  }
  return <Dialog open title={strategy ? copy.trainingGate.editStrategy : copy.trainingGate.addStrategy} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={(event) => void save(event)} className="space-y-4" aria-busy={busy}>
      <div className="space-y-2"><Label htmlFor="strategy-name">{copy.trainingGate.strategyName}</Label><Input id="strategy-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={busy} /></div>
      <div className="space-y-2"><Label>{copy.trainingGate.checklist}</Label><p className="text-xs text-slate-500">{copy.trainingGate.checklistHint}</p>
        {checklist.map((item, index) => <div key={item.id} className="space-y-2 rounded-md border p-3"><Label htmlFor={`check-${item.id}`}>{copy.trainingGate.itemLabel(index + 1)}</Label><div className="flex flex-wrap gap-2"><Input id={`check-${item.id}`} value={item.text} onChange={(event) => setChecklist((items) => items.map((value) => value.id === item.id ? { ...value, text: event.target.value } : value))} maxLength={1000} required disabled={busy} className="min-w-0 flex-[1_1_180px]" />
          <Button variant="outline" size="icon" type="button" disabled={busy || index === 0} onClick={() => move(index, index - 1)} aria-label={copy.trainingGate.moveUp}><ArrowUp className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" type="button" disabled={busy || index === checklist.length - 1} onClick={() => move(index, index + 1)} aria-label={copy.trainingGate.moveDown}><ArrowDown className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" type="button" disabled={busy} onClick={() => setChecklist((items) => items.filter((value) => value.id !== item.id))} aria-label={copy.trainingGate.removeItem}><Trash2 className="h-4 w-4 text-red-600" /></Button></div></div>)}
        <Button variant="outline" type="button" disabled={busy || checklist.length >= 100} onClick={() => setChecklist((items) => [...items, { id: crypto.randomUUID(), text: "" }])}><Plus className="h-4 w-4" />{copy.trainingGate.addItem}</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.masterData.options.save}</Button></div>
    </form>
  </Dialog>;
}
