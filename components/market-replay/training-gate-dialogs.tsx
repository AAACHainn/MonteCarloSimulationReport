"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Info, Loader2 } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import Image from "next/image";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { MARKET_CONTEXTS, type MarketContext, type TrainingGateMode, type TrainingGateState } from "@/lib/paper-trading/training-gate";
import type { GateApprovalInput, PaperOrderInput } from "@/lib/paper-trading/types";
import type { PlanEntryDraft } from "@/lib/paper-trading/entry-check-draft";
import type { ManagedStrategy } from "@/components/master-data/strategy-manager";
import { reconcileEntryCheckApproval } from "@/lib/paper-trading/entry-check-draft";

export function TrainingGateConfigDialog({ gate, busy, error, onClose, onSave }: {
  gate: TrainingGateState; busy: boolean; error: string | null; onClose: () => void;
  onSave: (config: { tradeCount: number; autoEnabled: boolean; lossThreshold: number; nextMode: TrainingGateMode }, start: boolean) => Promise<void>;
}) {
  const [count, setCount] = useState(String(gate.tradeCount));
  const [autoEnabled, setAutoEnabled] = useState(gate.autoEnabled);
  const [threshold, setThreshold] = useState(String(gate.lossThreshold));
  const [nextMode, setNextMode] = useState<TrainingGateMode>(gate.nextMode);
  const number = Number(count);
  const thresholdNumber = Number(threshold);
  const validCount = Number.isInteger(number) && number > 0 && number <= 2147483647;
  const validThreshold = Number.isInteger(thresholdNumber) && thresholdNumber > 0 && thresholdNumber <= 2147483647;
  const valid = validCount && (!autoEnabled || validThreshold);
  const config = { tradeCount: number, autoEnabled, lossThreshold: validThreshold ? thresholdNumber : gate.lossThreshold, nextMode };
  return <Dialog open title={copy.trainingGate.title} description={copy.trainingGate.description} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4" aria-busy={busy}>
      {gate.active ? <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><p>{gate.source === "LOSS_STREAK" ? copy.trainingGate.automatic : copy.trainingGate.manual} · {copy.trainingGate.activeMode}：{copy.trainingGate.modes[gate.activeMode ?? "CHECKLIST"]}</p><p className="tabular-nums">{copy.trainingGate.progress(gate.completedCount, gate.targetCount)}</p><p>{copy.trainingGate.locked}</p>{gate.cancelledOrderCount ? <p>{copy.trainingGate.cancelled(gate.cancelledOrderCount)}</p> : null}</div> : null}
      <p className="text-xs tabular-nums text-slate-600">{copy.trainingGate.autoStatus(gate.autoEnabled, gate.lossThreshold, gate.lossStreak)}</p>
      <div className="space-y-2"><Label htmlFor="gate-trade-count">{copy.trainingGate.tradeCount}</Label><Input id="gate-trade-count" type="number" min={1} max={2147483647} step={1} value={count} disabled={busy || gate.active} onChange={(event) => setCount(event.target.value)} aria-describedby="gate-count-hint" /><p id="gate-count-hint" className="text-xs text-slate-500">{copy.trainingGate.countHint}</p></div>
      <div className="space-y-2"><Label htmlFor="gate-next-mode">{copy.trainingGate.nextMode}</Label><Select value={nextMode} onValueChange={(value) => setNextMode(value as TrainingGateMode)} disabled={busy || gate.active}><SelectTrigger id="gate-next-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CHECKLIST">{copy.trainingGate.modes.CHECKLIST}</SelectItem><SelectItem value="PLAN">{copy.trainingGate.modes.PLAN}</SelectItem></SelectContent></Select></div>
      <CheckboxField checked={autoEnabled} disabled={busy || gate.active} onChange={setAutoEnabled}>{copy.trainingGate.autoEnabled}</CheckboxField>
      <div className="space-y-2"><Label htmlFor="gate-loss-threshold">{copy.trainingGate.lossThreshold}</Label><Input id="gate-loss-threshold" type="number" min={1} max={2147483647} step={1} value={threshold} disabled={busy || gate.active || !autoEnabled} onChange={(event) => setThreshold(event.target.value)} aria-describedby="gate-loss-hint" /><p id="gate-loss-hint" className="text-xs text-slate-500">{copy.trainingGate.lossThresholdHint}</p></div>
      {!valid ? <p className="text-sm text-red-600" role="alert">{!validCount ? copy.trainingGate.invalidCount : copy.trainingGate.invalidThreshold}</p> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button>
        {!gate.active ? <><Button variant="outline" disabled={busy || !valid} onClick={() => void onSave(config, false)}>{copy.trainingGate.save}</Button><Button disabled={busy || !valid} onClick={() => void onSave(config, true)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.trainingGate.start}</Button></> : null}
      </div>
    </div>
  </Dialog>;
}

type ChecklistApproval = Extract<GateApprovalInput, { strategyId: string }>;
type PlanApproval = Extract<GateApprovalInput, { mode: "PLAN" }>;

export function EntryCheckDialog(props: {
  order: PaperOrderInput; busy: boolean; error: string | null; onClose: () => void;
  mode: TrainingGateMode; displayIntervalSeconds: number;
  approval: GateApprovalInput | null; onApprovalChange: (approval: GateApprovalInput | null) => void;
  planDraft: PlanEntryDraft; onPlanDraftChange: (draft: PlanEntryDraft) => void;
  onConfirm: (approval: GateApprovalInput) => Promise<boolean>;
}) {
  if (props.mode === "PLAN") return <PlanEntryDialog order={props.order} draft={props.planDraft}
    onDraftChange={props.onPlanDraftChange} displayIntervalSeconds={props.displayIntervalSeconds}
    busy={props.busy} error={props.error} onClose={props.onClose} onConfirm={props.onConfirm} />;
  return <ChecklistEntryDialog {...props} approval={props.approval?.mode === "PLAN" ? null : props.approval} />;
}

function ChecklistEntryDialog({ order, approval, onApprovalChange, busy, error, onClose, onConfirm }: {
  order: PaperOrderInput; busy: boolean; error: string | null; onClose: () => void;
  approval: ChecklistApproval | null; onApprovalChange: (approval: GateApprovalInput | null) => void;
  onConfirm: (approval: GateApprovalInput) => Promise<boolean>;
}) {
  const [strategies, setStrategies] = useState<ManagedStrategy[]>([]);
  const approvalRef = useRef<ChecklistApproval | null>(approval);
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

function PlanEntryDialog({ order, draft, onDraftChange, displayIntervalSeconds, busy, error, onClose, onConfirm }: {
  order: PaperOrderInput; draft: PlanEntryDraft; onDraftChange: (draft: PlanEntryDraft) => void;
  displayIntervalSeconds: number; busy: boolean; error: string | null; onClose: () => void;
  onConfirm: (approval: PlanApproval) => Promise<boolean>;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPinned, setHelpPinned] = useState(false);
  const helpCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHelpClose = () => {
    if (helpCloseTimer.current !== null) clearTimeout(helpCloseTimer.current);
    helpCloseTimer.current = null;
  };
  const scheduleHelpClose = () => {
    cancelHelpClose();
    helpCloseTimer.current = setTimeout(() => {
      helpCloseTimer.current = null;
      setHelpOpen(false);
    }, 200);
  };
  useEffect(() => () => {
    if (helpCloseTimer.current !== null) clearTimeout(helpCloseTimer.current);
  }, []);
  const count = Array.from(draft.plan).length;
  const ready = Boolean(draft.context && draft.plan.trim() && count <= 800);
  return <Dialog open modal={false} movable title={copy.trainingGate.modes.PLAN} description={copy.trainingGate.planHint} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4" aria-busy={busy}>
      <section className="rounded-md border bg-slate-50 p-3 text-sm"><h3 className="font-medium">{copy.trainingGate.orderSummary}</h3><p className="mt-2 tabular-nums">{order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell} · {order.type === "MARKET" ? copy.paperTrading.market : order.type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop} · {copy.paperTrading.quantity} {formatNumber(order.quantity)}</p><p className="mt-1 tabular-nums">{copy.paperTrading.orderPrice} {order.price == null ? copy.common.dash : formatNumber(order.price)} · {copy.paperTrading.stopLoss} {order.stopLoss == null ? copy.common.dash : formatNumber(order.stopLoss)} · {copy.paperTrading.takeProfit} {order.takeProfit == null ? copy.common.dash : formatNumber(order.takeProfit)}</p></section>
      <div className="space-y-2">
        <div className="flex items-center gap-1"><Label htmlFor="gate-context">{copy.trainingGate.marketContext}</Label>
          <Popover.Root open={helpOpen} onOpenChange={(open) => { cancelHelpClose(); setHelpOpen(open); if (!open) setHelpPinned(false); }}>
            <Popover.Trigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={copy.trainingGate.marketContextHelp} aria-expanded={helpOpen}
              onMouseEnter={() => { cancelHelpClose(); setHelpOpen(true); }} onMouseLeave={() => { if (!helpPinned) scheduleHelpClose(); }}
              onFocus={() => { cancelHelpClose(); setHelpOpen(true); }} onClick={(event) => { event.preventDefault(); cancelHelpClose(); setHelpPinned(!helpPinned); setHelpOpen(!helpPinned); }}><Info className="h-4 w-4" aria-hidden="true" /></Button></Popover.Trigger>
            <Popover.Portal><Popover.Content side="bottom" align="center" sideOffset={8} collisionPadding={16} onMouseEnter={() => { cancelHelpClose(); setHelpOpen(true); }} onMouseLeave={() => { if (!helpPinned) scheduleHelpClose(); }}
              className="z-[250] max-h-[calc(100dvh-2rem)] w-[min(92vw,1100px)] overflow-auto rounded-lg border bg-white p-2 shadow-xl">
              <p className="mb-2 text-xs text-slate-600">{copy.trainingGate.marketContextHint}</p>
              <Image src="/market-context-decision-tree.svg" alt={copy.trainingGate.marketContextHelp} width={1560} height={880} unoptimized className="min-w-[1000px] max-w-none" />
            </Popover.Content></Popover.Portal>
          </Popover.Root>
        </div>
        <Select value={draft.context ?? ""} onValueChange={(context) => onDraftChange({ ...draft, context: context as MarketContext })} disabled={busy}>
          <SelectTrigger id="gate-context" className="min-w-0 [&>span:first-child]:truncate"><SelectValue placeholder={copy.trainingGate.marketContext} /></SelectTrigger>
          <SelectContent>{MARKET_CONTEXTS.map((context) => <SelectItem key={context} value={context}>{copy.trainingGate.marketContextPaths[context]}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-slate-500">{copy.trainingGate.marketContextHint}</p>
      </div>
      <div className="space-y-2"><Label htmlFor="gate-plan">{copy.trainingGate.plan}</Label>
        <Textarea id="gate-plan" value={draft.plan} onChange={(event) => onDraftChange({ ...draft, plan: Array.from(event.target.value).slice(0, 800).join("") })} placeholder={copy.trainingGate.planPlaceholder} disabled={busy} aria-describedby="gate-plan-count" className="min-h-32" />
        <p id="gate-plan-count" className="text-right text-xs tabular-nums text-slate-500">{copy.trainingGate.planCount(count)}</p>
      </div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button><Button disabled={busy || !ready} onClick={() => { if (draft.context) void onConfirm({ mode: "PLAN", context: draft.context, plan: draft.plan.trim(), displayIntervalSeconds }); }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.paperTrading.confirmDraft}</Button></div>
    </div>
  </Dialog>;
}
