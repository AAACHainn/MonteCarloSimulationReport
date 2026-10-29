"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Info, Loader2 } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import Image from "next/image";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { type TrainingGateMode } from "@/lib/paper-trading/training-gate";
import type { GateApprovalInput, PaperOrderInput } from "@/lib/paper-trading/types";
import type { PlanEntryDraft } from "@/lib/paper-trading/entry-check-draft";
import type { ManagedStrategy } from "@/components/master-data/strategy-manager";
import { reconcileEntryCheckApproval } from "@/lib/paper-trading/entry-check-draft";
import { MARKET_CONTEXT_DECISIONS, decisionStepForContext, previousDecisionStep, type MarketContextDecisionStep } from "@/lib/paper-trading/market-context-decision";

export { TrainingGateConfigDialog } from "./training-gate-config-dialog";

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
  const count = Array.from(draft.plan).length;
  const ready = Boolean(draft.context && draft.plan.trim() && count <= 800);
  return <Dialog open modal={false} movable title={copy.trainingGate.modes.PLAN} description={copy.trainingGate.planHint} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4" aria-busy={busy}>
      <section className="rounded-md border bg-slate-50 p-3 text-sm"><h3 className="font-medium">{copy.trainingGate.orderSummary}</h3><p className="mt-2 tabular-nums">{order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell} · {order.type === "MARKET" ? copy.paperTrading.market : order.type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop} · {copy.paperTrading.quantity} {formatNumber(order.quantity)}</p><p className="mt-1 tabular-nums">{copy.paperTrading.orderPrice} {order.price == null ? copy.common.dash : formatNumber(order.price)} · {copy.paperTrading.stopLoss} {order.stopLoss == null ? copy.common.dash : formatNumber(order.stopLoss)} · {copy.paperTrading.takeProfit} {order.takeProfit == null ? copy.common.dash : formatNumber(order.takeProfit)}</p></section>
      <MarketContextDecisionPicker draft={draft} onDraftChange={onDraftChange} busy={busy} />
      <div className="space-y-2"><Label htmlFor="gate-plan">{copy.trainingGate.plan}</Label>
        <Textarea id="gate-plan" value={draft.plan} onChange={(event) => onDraftChange({ ...draft, plan: Array.from(event.target.value).slice(0, 800).join("") })} placeholder={copy.trainingGate.planPlaceholder} disabled={busy} aria-describedby="gate-plan-count" className="min-h-32" />
        <p id="gate-plan-count" className="text-right text-xs tabular-nums text-slate-500">{copy.trainingGate.planCount(count)}</p>
      </div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button><Button disabled={busy || !ready} onClick={() => { if (draft.context) void onConfirm({ mode: "PLAN", context: draft.context, plan: draft.plan.trim(), displayIntervalSeconds }); }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.paperTrading.confirmDraft}</Button></div>
    </div>
  </Dialog>;
}

function MarketContextDecisionPicker({ draft, onDraftChange, busy }: {
  draft: PlanEntryDraft; onDraftChange: (draft: PlanEntryDraft) => void; busy: boolean;
}) {
  const step: MarketContextDecisionStep = draft.context ? decisionStepForContext(draft.context) : draft.contextStep ?? "START";
  const choices = MARKET_CONTEXT_DECISIONS[step];
  return <fieldset className="space-y-2" disabled={busy}>
    <legend className="mb-2 text-sm font-medium">{copy.trainingGate.marketContext}</legend>
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">
      <p className="text-sm font-medium text-slate-700" aria-live="polite">{copy.trainingGate.contextDecisionPrompts[step]}</p>
      <MarketContextHelp />
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      {choices.map((choice) => {
        const finalContext = "context" in choice ? choice.context : null;
        const nextStep = "next" in choice ? choice.next : null;
        const selected = finalContext !== null && draft.context === finalContext;
        const rangeChoice = step === "RANGE" || nextStep === "RANGE";
        const tone = rangeChoice
          ? selected
            ? "border-emerald-500 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100 hover:text-emerald-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-900"
          : selected
            ? "border-blue-500 bg-blue-100 text-blue-900 ring-1 ring-blue-200 hover:bg-blue-100 hover:text-blue-900"
            : "border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-400 hover:bg-blue-100 hover:text-blue-900";
        const label = "context" in choice ? copy.trainingGate.marketContexts[choice.context] : copy.trainingGate.contextBranches[choice.next];
        return <Button key={"context" in choice ? choice.context : choice.next} type="button" variant="outline" aria-pressed={finalContext ? selected : undefined}
          className={`h-14 w-full justify-between whitespace-normal px-4 text-left ${tone}`}
          onClick={() => { if (finalContext) onDraftChange({ ...draft, context: finalContext, contextStep: step }); else if (nextStep) onDraftChange({ ...draft, context: null, contextStep: nextStep }); }}>
          <span>{label}</span>{selected ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : finalContext ? null : <ChevronRight className={`h-4 w-4 shrink-0 ${rangeChoice ? "text-emerald-500" : "text-blue-500"}`} aria-hidden="true" />}
        </Button>;
      })}
    </div>
    <div className="flex min-h-9 items-center justify-between gap-2">
      {step === "START" ? <span /> : <Button type="button" variant="ghost" size="sm" onClick={() => onDraftChange({ ...draft, context: null, contextStep: previousDecisionStep(step) })}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{copy.trainingGate.contextBack}</Button>}
      {draft.context ? <p className={`text-right text-xs ${step === "RANGE" ? "text-emerald-700" : "text-blue-700"}`} role="status">{copy.trainingGate.contextChosen(copy.trainingGate.marketContextPaths[draft.context])}</p> : null}
    </div>
    <p className="text-xs text-slate-500">{copy.trainingGate.marketContextHint}</p>
  </fieldset>;
}

function MarketContextHelp() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false); }, 200);
  };
  useEffect(() => () => { if (closeTimer.current !== null) clearTimeout(closeTimer.current); }, []);
  return <Popover.Root open={open} onOpenChange={(nextOpen) => { cancelClose(); setOpen(nextOpen); }}>
    <Popover.Trigger asChild><Button type="button" variant="ghost" size="icon" className="shrink-0 text-slate-600 hover:bg-slate-100 hover:text-slate-800" aria-label={copy.trainingGate.marketContextHelp}
      onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={closeSoon}
      onFocus={() => { cancelClose(); setOpen(true); }} onBlur={closeSoon}
      onClick={(event) => { event.preventDefault(); cancelClose(); setOpen(true); }}><Info className="h-4 w-4" aria-hidden="true" /></Button></Popover.Trigger>
    <Popover.Portal><Popover.Content side="bottom" align="center" sideOffset={8} collisionPadding={16}
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={closeSoon}
      onFocusCapture={() => { cancelClose(); setOpen(true); }}
      className="z-[250] max-h-[calc(100dvh-2rem)] w-[min(90vw,1024px)] overflow-auto rounded-lg border bg-white p-2 shadow-xl">
      <p className="mb-2 text-xs text-slate-600">{copy.trainingGate.marketContextHint}</p>
      <Image src="/market-context-decision-tree.svg" alt={copy.trainingGate.marketContextHelp} width={1560} height={880} unoptimized className="h-auto w-full min-w-[760px] max-w-none lg:min-w-0" />
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
