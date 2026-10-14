"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import type { TrainingGateState } from "@/lib/paper-trading/training-gate";
import type { GateApprovalInput, PaperOrderInput } from "@/lib/paper-trading/types";
import type { ManagedStrategy } from "@/components/master-data/strategy-manager";
import { reconcileEntryCheckApproval } from "@/lib/paper-trading/entry-check-draft";

export function TrainingGateConfigDialog({ gate, busy, error, onClose, onSave }: {
  gate: TrainingGateState; busy: boolean; error: string | null; onClose: () => void;
  onSave: (count: number, start: boolean) => Promise<void>;
}) {
  const [count, setCount] = useState(String(gate.tradeCount));
  const number = Number(count);
  const valid = Number.isInteger(number) && number > 0 && number <= 2147483647;
  return <Dialog open title={copy.trainingGate.title} description={copy.trainingGate.description} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4" aria-busy={busy}>
      {gate.active ? <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><p>{gate.source === "LOSS_STREAK" ? copy.trainingGate.automatic : copy.trainingGate.manual}</p><p className="tabular-nums">{copy.trainingGate.progress(gate.completedCount, gate.targetCount)}</p><p>{copy.trainingGate.locked}</p>{gate.cancelledOrderCount ? <p>{copy.trainingGate.cancelled(gate.cancelledOrderCount)}</p> : null}</div> : null}
      <div className="space-y-2"><Label htmlFor="gate-trade-count">{copy.trainingGate.tradeCount}</Label><Input id="gate-trade-count" type="number" min={1} max={2147483647} step={1} value={count} disabled={busy || gate.active} onChange={(event) => setCount(event.target.value)} aria-describedby="gate-count-hint" /><p id="gate-count-hint" className="text-xs text-slate-500">{copy.trainingGate.countHint}</p></div>
      {!valid ? <p className="text-sm text-red-600" role="alert">{copy.trainingGate.invalidCount}</p> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button>
        {!gate.active ? <><Button variant="outline" disabled={busy || !valid} onClick={() => void onSave(number, false)}>{copy.trainingGate.save}</Button><Button disabled={busy || !valid} onClick={() => void onSave(number, true)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.trainingGate.start}</Button></> : null}
      </div>
    </div>
  </Dialog>;
}

export function EntryCheckDialog({ order, approval, onApprovalChange, busy, error, onClose, onConfirm }: {
  order: PaperOrderInput; busy: boolean; error: string | null; onClose: () => void;
  approval: GateApprovalInput | null; onApprovalChange: (approval: GateApprovalInput | null) => void;
  onConfirm: (approval: GateApprovalInput) => Promise<boolean>;
}) {
  const [strategies, setStrategies] = useState<ManagedStrategy[]>([]);
  const approvalRef = useRef(approval);
  const onApprovalChangeRef = useRef(onApprovalChange);
  approvalRef.current = approval;
  onApprovalChangeRef.current = onApprovalChange;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setLoadError(null);
    try {
      const response = await fetch("/api/trade-options", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(copy.trainingGate.failed);
      if (signal?.aborted) return;
      const available = data.filter((option: ManagedStrategy & { type: string }) => option.type === "STRATEGY" && option.active && option.checklist.length);
      setStrategies(available);
      onApprovalChangeRef.current(reconcileEntryCheckApproval(approvalRef.current, available));
    } catch (error) { if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : copy.trainingGate.failed); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => { if (error !== copy.trainingGate.checklistChanged && error !== copy.trainingGate.invalidStrategy) return; const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [error, load]);
  const selected = strategies.find((strategy) => strategy.id === approval?.strategyId);
  const checked = approval?.checkedItemIds ?? [];
  const ready = selected && selected.checklistVersion === approval?.checklistVersion && selected.checklist.length > 0 && selected.checklist.every((item) => checked.includes(item.id));
  const close = () => { if (!busy) onClose(); };
  return <Dialog open modal={false} movable title={copy.trainingGate.selectStrategy} description={copy.trainingGate.checkDescription} onClose={close}>
    <div className="space-y-4" aria-busy={busy || loading}>
      <section className="rounded-md border bg-slate-50 p-3 text-sm"><h3 className="font-medium">{copy.trainingGate.orderSummary}</h3><p className="mt-2 tabular-nums">{order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell} · {order.type === "MARKET" ? copy.paperTrading.market : order.type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop} · {copy.paperTrading.quantity} {formatNumber(order.quantity)}</p><p className="mt-1 tabular-nums">{copy.paperTrading.orderPrice} {order.price == null ? copy.common.dash : formatNumber(order.price)} · {copy.paperTrading.stopLoss} {order.stopLoss == null ? copy.common.dash : formatNumber(order.stopLoss)} · {copy.paperTrading.takeProfit} {order.takeProfit == null ? copy.common.dash : formatNumber(order.takeProfit)}</p></section>
      {loading ? <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{copy.trainingGate.loadingStrategies}</p> : loadError ? <div><p role="alert" className="text-sm text-red-600">{loadError}</p><Button variant="outline" onClick={() => void load()}>{copy.trainingGate.retry}</Button></div> : !strategies.length ? <div className="space-y-3 rounded-md border border-dashed p-6"><p className="text-sm text-slate-600">{copy.trainingGate.noStrategies}</p><Button asChild variant="outline"><Link href="/master-data" target="_blank" rel="noopener noreferrer">{copy.trainingGate.configureStrategies}</Link></Button><Button variant="ghost" onClick={() => void load()}>{copy.trainingGate.retry}</Button></div> : <>
        <div className="space-y-2"><Label htmlFor="gate-strategy">{copy.trainingGate.strategy}</Label><Select value={approval?.strategyId ?? ""} onValueChange={(id) => { const strategy = strategies.find((item) => item.id === id); if (strategy && id !== approval?.strategyId) onApprovalChange({ strategyId: id, checklistVersion: strategy.checklistVersion, checkedItemIds: [] }); }} disabled={busy}><SelectTrigger id="gate-strategy"><SelectValue placeholder={copy.trainingGate.selectStrategy} /></SelectTrigger><SelectContent onEscapeKeyDown={(event) => event.stopPropagation()}>{strategies.map((strategy) => <SelectItem value={strategy.id} key={strategy.id}>{strategy.name}</SelectItem>)}</SelectContent></Select></div>
        {selected ? <section className="space-y-2"><h3 className="text-sm font-medium">{copy.trainingGate.checklist}</h3>{selected.checklist.map((item) => <CheckboxField key={item.id} disabled={busy} checked={checked.includes(item.id)} onChange={(value) => onApprovalChange({ strategyId: selected.id, checklistVersion: selected.checklistVersion, checkedItemIds: value ? [...new Set([...checked, item.id])] : checked.filter((id) => id !== item.id) })}>{item.text}</CheckboxField>)}<p className="text-xs tabular-nums text-slate-500" role="status">{copy.trainingGate.checked(checked.length, selected.checklist.length)}</p></section> : null}
      </>}
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" disabled={busy} onClick={close}>{copy.common.cancel}</Button><Button disabled={busy || loading || !ready} onClick={() => { if (selected) void onConfirm({ strategyId: selected.id, checklistVersion: selected.checklistVersion, checkedItemIds: checked }); }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.paperTrading.confirmDraft}</Button></div>
    </div>
  </Dialog>;
}
