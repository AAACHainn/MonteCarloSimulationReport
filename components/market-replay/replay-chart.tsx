"use client";


import { aggregateHasGap, aggregatePhase } from "@/lib/market-replay/bar-quality";
import { formatInteger } from "@/lib/format";
import { type PointerEvent as ReactPointerEvent } from "react";
import { EyeOff, Grid2X2, GripHorizontal, Link2, Loader2, LogOut, RotateCcw, ShieldAlert, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isClosingOrder } from "@/lib/paper-trading/training-gate";
import { copy } from "@/lib/i18n";
import { formatUtcDateTime, formatUtcOffset } from "@/lib/market-replay/display-timezone";
import { formatPriceForTick } from "@/lib/market-replay/price-ticks";
import { number, money, compactVolume, formatAbrValue, sizingErrorText, orderTypeLabel } from "./replay-chart-shared";
import type { ReplayChartProps } from "./replay-chart-shared";
export type { ReplayVisibleSequenceRange } from "./replay-chart-shared";
import { useReplayChartCore } from "./use-replay-chart-core";
import { useReplayChartSetup } from "./use-replay-chart-setup";
import { useReplayChartDrawingPointer } from "./use-replay-chart-drawing-pointer";
import { useReplayChartMeasurement } from "./use-replay-chart-measurement";
import { useReplayChartOrderInteractions } from "./use-replay-chart-order-interactions";
import { useReplayChartActions } from "./use-replay-chart-actions";

export function ReplayChart(props: ReplayChartProps) {
  const core = useReplayChartCore(props);
  const setup = useReplayChartSetup(core);
  useReplayChartDrawingPointer(core);
  useReplayChartMeasurement(core);
  useReplayChartOrderInteractions(core, setup);
  const actions = useReplayChartActions(core, setup);
  const {
    visibilityScope, setHiddenBoundary, hiddenAfter, visibleBars, containerRef, interactionRef,
    orderTicketRef, orderTicketDragRef, contextMenu, setContextMenu, contextMenuRef, abrTooltip,
    setAbrTooltip, measurement, draft, setDraft, orderTicketPosition, setOrderTicketPosition,
    defaultSaved, setDefaultSaved, draftError, setDraftError, lineActions, latest,
    currentPrice, hasPendingClose, priceTickSize, bars, displayUtcOffsetMinutes, gridVisible,
    onToggleGrid, abrEnabled, abrLength, paperSnapshot, tradeAnnotationsTruncated, tradeAnnotationsVisible,
    readOnly, paperBusy, paperError, onCancelOrder, onClosePosition, entryCheckOpen,
    onOpenPaperAccount, onRewindToBar,
  } = core;
  const {
    draftSizing,
  } = setup;
  const {
    openContextMenu, resetChartView, createDraft, setDraftPrice, setTargetR, saveDefaults,
    submitDraft, contextEntryOrderTypes, measurementColor, measurementGeometry, measurementDuration, measurementLabelLeft,
    measurementLabelTop,
  } = actions;
  return (
    <div
      ref={interactionRef}
      className="relative h-full min-h-0 select-none"
      onContextMenu={openContextMenu}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (!(event.target as HTMLElement).closest("[data-context-menu]")) setContextMenu(null);
      }}
    >
      <div
        ref={containerRef}
        className="h-full min-h-[240px] w-full overflow-hidden bg-white"
        aria-label={copy.marketReplay.chartAriaLabel}
        data-bar-count={bars.length}
        data-visible-bar-count={visibleBars.length}
      />

      {hiddenAfter ? <Alert data-hidden-bars-notice role="status" aria-live="polite"
        className="absolute bottom-3 left-3 z-30 flex w-auto max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="flex items-center gap-2 font-medium text-slate-700"><EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.marketReplay.subsequentBarsHidden}</span>
        <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-8" data-testid="restore-subsequent-bars" aria-label={copy.marketReplay.restoreSubsequentBars}
          onClick={() => { setHiddenBoundary(null); setAbrTooltip(null); }}>{copy.marketReplay.restoreSubsequentBars}</Button>
      </Alert> : null}

      {tradeAnnotationsVisible && tradeAnnotationsTruncated ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-md bg-amber-50/95 px-2 py-1 text-[11px] text-amber-800 shadow-sm backdrop-blur">
          {copy.paperTrading.tradeAnnotationLimit(100)}
        </div>
      ) : null}

      {abrTooltip ? (
        <div
          data-testid="abr-bar-tooltip"
          className="pointer-events-none absolute z-30 w-[196px] rounded-md border border-slate-200 bg-white/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur"
          style={{ left: abrTooltip.left, top: abrTooltip.top }}
        >
          <div className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-1.5">
            {abrEnabled ? (
              <>
                <span className="font-medium text-slate-600">{copy.marketReplay.abrName(abrLength)}</span>
                <span className="font-mono font-semibold text-slate-950">{formatAbrValue(abrTooltip.value, priceTickSize)}</span>
              </>
            ) : null}
            <span className="text-slate-600">{copy.marketReplay.abrOpen}</span>
            <span className="font-mono font-semibold text-slate-950">{formatPriceForTick(abrTooltip.bar.open, priceTickSize)}</span>
            <span className="text-slate-600">{copy.marketReplay.abrHigh}</span>
            <span className="font-mono font-semibold text-slate-950">{formatPriceForTick(abrTooltip.bar.high, priceTickSize)}</span>
            <span className="text-slate-600">{copy.marketReplay.abrLow}</span>
            <span className="font-mono font-semibold text-slate-950">{formatPriceForTick(abrTooltip.bar.low, priceTickSize)}</span>
            <span className="text-slate-600">{copy.marketReplay.abrClose}</span>
            <span className="font-mono font-semibold text-slate-950">{formatPriceForTick(abrTooltip.bar.close, priceTickSize)}</span>
            <span className="text-slate-600">{copy.marketReplay.barEmission.phaseLabel}</span>
            <span className="text-right text-slate-950">{copy.marketReplay.barEmission.phase[aggregatePhase(abrTooltip.bar)]}</span>
            <span className="text-slate-600">{copy.marketReplay.barEmission.qualityLabel}</span>
            <span className={aggregateHasGap(abrTooltip.bar) ? "text-right text-amber-800" : "text-right text-slate-950"}>{copy.marketReplay.barEmission.quality[abrTooltip.bar.quality ?? (aggregateHasGap(abrTooltip.bar) ? "GAP" : "UNKNOWN")]}</span>
            <span className="text-slate-600">{copy.marketReplay.barEmission.records}</span>
            <span className="text-right font-mono tabular-nums text-slate-950">{formatInteger(abrTooltip.bar.sourceCount)} / {formatInteger(abrTooltip.bar.expectedCount)}</span>
          </div>
        </div>
      ) : null}

      {measurement && measurementGeometry ? (
        <div
          data-testid="chart-measurement"
          className="pointer-events-none absolute left-0 top-0 z-10 overflow-hidden"
          style={{ width: measurement.paneWidth, height: measurement.paneHeight }}
        >
          <svg
            aria-hidden="true"
            className="absolute inset-0"
            width={measurement.paneWidth}
            height={measurement.paneHeight}
            viewBox={`0 0 ${measurement.paneWidth} ${measurement.paneHeight}`}
          >
            <rect
              x={measurementGeometry.left}
              y={measurementGeometry.top}
              width={measurementGeometry.width}
              height={measurementGeometry.height}
              fill={measurementColor}
              fillOpacity="0.16"
            />
            <line
              x1={measurementGeometry.left}
              y1={measurementGeometry.middleY}
              x2={measurementGeometry.right}
              y2={measurementGeometry.middleY}
              stroke={measurementColor}
              strokeWidth="1.25"
              opacity="0.9"
            />
            <line
              x1={measurementGeometry.middleX}
              y1={measurementGeometry.top}
              x2={measurementGeometry.middleX}
              y2={measurementGeometry.bottom}
              stroke={measurementColor}
              strokeWidth="1.25"
              opacity="0.9"
            />
          </svg>
          <div
            className="absolute min-w-[176px] -translate-x-1/2 rounded-md px-3 py-2 text-center text-xs font-medium leading-5 text-white shadow-lg"
            style={{ left: measurementLabelLeft, top: measurementLabelTop, backgroundColor: measurementColor }}
          >
            <div className="font-mono font-semibold">
              {formatPriceForTick(measurement.stats.priceChange, priceTickSize)}
              {" "}({measurement.stats.percentageChange.toFixed(2)}%){" "}
              {measurement.stats.tickChange.toLocaleString("zh-CN")}
            </div>
            <div>{copy.marketReplay.measurementSpan(measurement.stats.barCount, measurementDuration)}</div>
            {measurement.stats.volume !== null ? (
              <div>{copy.marketReplay.measurementVolume(compactVolume(measurement.stats.volume))}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {lineActions.map((action) => (
        <div
          key={action.key}
          data-line-action
          data-testid={`line-action-${action.kind}-${action.key}`}
          className="absolute right-16 z-20 flex max-w-[360px] -translate-y-1/2 items-center overflow-hidden rounded-md border bg-white/95 text-[11px] shadow-sm backdrop-blur"
          style={{ top: action.y, borderColor: `${action.color}66`, color: action.color }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span
            data-line-drag-key={action.kind === "cancel" ? action.key : undefined}
            className={action.kind === "cancel" ? "cursor-ns-resize touch-none truncate px-2 py-1 font-medium" : "truncate px-2 py-1 font-medium"}
            title={action.kind === "cancel" ? copy.paperTrading.dragHint : undefined}
          >
            {action.label}
          </span>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 border-l px-2 py-1 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: `${action.color}44` }}
            disabled={paperBusy || (action.kind === "close" && hasPendingClose)}
            aria-label={action.kind === "cancel" ? copy.paperTrading.cancelOrderFromLine(action.label) : copy.paperTrading.oneClickClose}
            onClick={() => action.kind === "cancel" && action.orderId ? void onCancelOrder(action.orderId) : void onClosePosition()}
          >
            {action.kind === "cancel" ? <X className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
            {action.kind === "cancel" ? copy.paperTrading.cancelFromLine : hasPendingClose ? copy.paperTrading.closePending : copy.paperTrading.oneClickClose}
          </button>
        </div>
      ))}

      {latest && (aggregatePhase(latest) === "FORMING" || aggregateHasGap(latest)) ? (
        <div className={`pointer-events-none absolute left-3 top-3 rounded-md px-2 py-1 text-xs shadow-sm ${aggregateHasGap(latest) ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-blue-800"}`}>
          {aggregateHasGap(latest) ? copy.marketReplay.incompleteBar(latest.sourceCount, latest.expectedCount) : copy.marketReplay.formingBar(latest.sourceCount, latest.expectedCount)}
        </div>
      ) : null}

      {!draft && paperSnapshot && latest ? <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow-sm backdrop-blur">{copy.paperTrading.rightClickHint}</div> : null}

      {contextMenu ? (
        <div ref={contextMenuRef} data-context-menu role="menu" className="absolute z-40 max-h-[calc(100%-1rem)] w-[220px] max-w-[calc(100%-1rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {!readOnly ? (
            <button type="button" role="menuitem" data-testid="context-reset-chart-view" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={resetChartView}>
              <RotateCcw className="h-4 w-4" />
              {copy.marketReplay.resetChartView}
            </button>
          ) : null}
          {contextMenu.hideAfter ? <Button type="button" role="menuitem" variant="ghost" data-testid="context-hide-subsequent-bars"
            className="w-full justify-start px-2 text-left font-medium text-slate-700"
            onClick={() => { const target = contextMenu.hideAfter; if (target) setHiddenBoundary({ scope: visibilityScope, target }); setContextMenu(null); setAbrTooltip(null); }}>
            <EyeOff className="h-4 w-4" aria-hidden="true" />{copy.marketReplay.hideSubsequentBars}
          </Button> : null}
          {!readOnly ? <>
          <div className="mb-1 border-b pb-1">
            {onToggleGrid ? (
              <Button
                type="button"
                role="menuitem"
                variant="ghost"
                className="w-full justify-start px-2 text-left font-medium text-slate-700"
                onClick={() => { onToggleGrid(); setContextMenu(null); }}
              >
                <Grid2X2 className="h-4 w-4" aria-hidden="true" />
                {gridVisible ? copy.marketReplay.hideBackgroundGrid : copy.marketReplay.showBackgroundGrid}
              </Button>
            ) : null}
          </div>
          {onRewindToBar && contextMenu.rewindTarget ? <div className="mb-1 border-b pb-1">
            <Button type="button" role="menuitem" variant="ghost" data-testid="context-rewind-to-bar" disabled={paperBusy || entryCheckOpen}
              className="w-full justify-start px-2 text-left text-slate-700" title={paperBusy ? copy.replaySessions.rewindWait : undefined}
              onClick={() => { const target = contextMenu.rewindTarget; setContextMenu(null); if (target) onRewindToBar(target); }}>
              <Undo2 className="h-4 w-4" aria-hidden="true" />{copy.replaySessions.rewindToBar}
            </Button>
            <p className="px-2 pb-1 text-xs tabular-nums text-slate-600">{copy.replaySessions.rewindSelectedBar} · {formatUtcOffset(displayUtcOffsetMinutes)}<br />{formatUtcDateTime(contextMenu.rewindTarget.timestamp, displayUtcOffsetMinutes)}</p>
            {paperBusy ? <p className="px-2 pb-1 text-xs text-slate-600">{copy.replaySessions.rewindWait}</p> : null}
          </div> : null}
          <div className="border-b px-2 py-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{copy.paperTrading.contextPrice}</p>
            <p className="font-mono text-sm font-semibold text-slate-900">{formatPriceForTick(contextMenu.price, priceTickSize)}</p>
          </div>
          {!paperSnapshot ? (
            <div className="space-y-2 p-2">
              <p className="text-xs leading-5 text-slate-600">{copy.paperTrading.contextNoAccount}</p>
              <Button type="button" size="sm" className="w-full" onClick={() => { setContextMenu(null); onOpenPaperAccount(); }}>{copy.paperTrading.openAccountSettings}</Button>
            </div>
          ) : !latest || currentPrice === null ? (
            <div className="flex gap-2 p-2 text-xs leading-5 text-amber-800"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{copy.paperTrading.contextNoBar}</div>
          ) : contextEntryOrderTypes ? (
            <fieldset disabled={entryCheckOpen || paperBusy} className="space-y-0.5 pt-1">
              {contextEntryOrderTypes.buy === "LIMIT" ? <button type="button" role="menuitem" data-testid="context-buy-limit" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50" onClick={() => createDraft("BUY", "LIMIT")}>{copy.paperTrading.buyLimit}</button> : null}
              {contextEntryOrderTypes.sell === "LIMIT" ? <button type="button" role="menuitem" data-testid="context-sell-limit" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-orange-700 hover:bg-orange-50" onClick={() => createDraft("SELL", "LIMIT")}>{copy.paperTrading.sellLimit}</button> : null}
              {contextEntryOrderTypes.sell === "STOP" ? <button type="button" role="menuitem" data-testid="context-sell-stop" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50" onClick={() => createDraft("SELL", "STOP")}>{copy.paperTrading.sellStop}</button> : null}
              {contextEntryOrderTypes.buy === "STOP" ? <button type="button" role="menuitem" data-testid="context-buy-stop" className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50" onClick={() => createDraft("BUY", "STOP")}>{copy.paperTrading.buyStop}</button> : null}
            </fieldset>
          ) : null}
          </> : null}
        </div>
      ) : null}

      {draft && paperSnapshot ? (
        <div
          ref={orderTicketRef}
          data-order-ticket
          data-testid="risk-order-ticket"
          className={`absolute z-30 w-[292px] rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur ${orderTicketPosition ? "" : "right-16 top-3"}`}
          style={orderTicketPosition ? { left: orderTicketPosition.x, top: orderTicketPosition.y } : undefined}
        >
          <div
            className="flex touch-none select-none items-start gap-2 border-b px-3 py-2.5 cursor-move"
            title={copy.paperTrading.dragOrderTicket}
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target as HTMLElement).closest("button,input")) return;
              const ticket = orderTicketRef.current;
              if (!ticket) return;
              const rect = ticket.getBoundingClientRect();
              orderTicketDragRef.current = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const drag = orderTicketDragRef.current;
              const interaction = interactionRef.current;
              const ticket = orderTicketRef.current;
              if (!drag || drag.pointerId !== event.pointerId || !interaction || !ticket) return;
              const interactionRect = interaction.getBoundingClientRect();
              const ticketRect = ticket.getBoundingClientRect();
              setOrderTicketPosition({
                x: Math.min(Math.max(8, event.clientX - interactionRect.left - drag.offsetX), Math.max(8, interactionRect.width - ticketRect.width - 8)),
                y: Math.min(Math.max(8, event.clientY - interactionRect.top - drag.offsetY), Math.max(8, interactionRect.height - ticketRect.height - 8)),
              });
            }}
            onPointerUp={(event) => {
              if (orderTicketDragRef.current?.pointerId !== event.pointerId) return;
              orderTicketDragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { orderTicketDragRef.current = null; }}
          >
            <GripHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${draft.side === "BUY" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{draft.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell}</span>
                <span className="text-sm font-semibold text-slate-950">{copy.paperTrading.draftTitle}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{copy.paperTrading.draftDescription}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" disabled={entryCheckOpen || paperBusy} className="-mr-1 -mt-1 h-7 w-7 shrink-0 cursor-pointer" aria-label={copy.paperTrading.cancelDraft} onClick={() => { setDraft(null); setDraftError(null); setOrderTicketPosition(null); }}><X className="h-4 w-4" /></Button>
          </div>
          <fieldset disabled={entryCheckOpen || paperBusy} className="space-y-3 p-3">
            <div className="grid grid-cols-3 gap-2">
              <div><Label htmlFor="draft-entry" className="text-[10px] text-blue-700">ENTRY · {orderTypeLabel(draft.type)}</Label><Input id="draft-entry" data-testid="draft-entry" type="number" step={priceTickSize} className="mt-1 h-8 px-2 font-mono text-xs" value={draft.entryPrice} onChange={(event) => setDraftPrice("entryPrice", Number(event.target.value))} /></div>
              <div><Label htmlFor="draft-sl" className="text-[10px] text-red-700">SL</Label><Input id="draft-sl" data-testid="draft-sl" type="number" step={priceTickSize} className="mt-1 h-8 px-2 font-mono text-xs" value={draft.stopLoss} onChange={(event) => setDraftPrice("stopLoss", Number(event.target.value))} /></div>
              <div><Label htmlFor="draft-tp" className="text-[10px] text-emerald-700">TP</Label><Input id="draft-tp" data-testid="draft-tp" type="number" step={priceTickSize} className="mt-1 h-8 px-2 font-mono text-xs" value={draft.takeProfit} onChange={(event) => setDraftPrice("takeProfit", Number(event.target.value))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="draft-risk" className="text-[11px]">{copy.paperTrading.fixedRiskAmount}</Label><Input id="draft-risk" data-testid="draft-risk" type="number" min="0.01" step="any" className="mt-1 h-8" value={draft.riskAmount} onChange={(event) => { setDraft((current) => current ? { ...current, riskAmount: Number(event.target.value) } : current); setDraftError(null); setDefaultSaved(false); }} /></div>
              <div><Label htmlFor="draft-target-r" className="text-[11px]">{copy.paperTrading.targetR}</Label><Input id="draft-target-r" data-testid="draft-target-r" type="number" min="0.01" step="0.1" className="mt-1 h-8" value={draft.targetR} onChange={(event) => { setTargetR(Number(event.target.value)); setDefaultSaved(false); }} /></div>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className={`inline-flex items-center gap-1 ${draft.tpMode === "LINKED" ? "text-blue-700" : "text-slate-500"}`}><Link2 className="h-3 w-3" />{draft.tpMode === "LINKED" ? copy.paperTrading.linkedTarget : copy.paperTrading.freeTarget}</span>
              <div className="flex items-center gap-1">
                {draft.tpMode === "FREE" ? <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => setTargetR(draft.targetR)}>{copy.paperTrading.restoreTargetR}</button> : null}
                <button type="button" className="font-medium text-slate-500 hover:text-slate-900" onClick={saveDefaults}>{defaultSaved ? copy.paperTrading.defaultSaved : copy.paperTrading.saveAsDefault}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-2.5 text-xs">
              <span className="text-slate-500">{copy.paperTrading.estimatedQuantity}</span><strong data-testid="draft-quantity" className="text-right font-mono font-semibold text-slate-900">{draftSizing?.ok ? number(draftSizing.value.quantity) : "—"}</strong>
              <span className="text-slate-500">{copy.paperTrading.estimatedLoss}</span><strong className="text-right font-medium text-red-700">{draftSizing?.ok ? `-${money(draftSizing.value.projectedLoss, paperSnapshot.session.currency)}` : "—"}</strong>
              <span className="text-slate-500">{copy.paperTrading.estimatedProfit}</span><strong className="text-right font-medium text-emerald-700">{draftSizing?.ok && draftSizing.value.projectedProfit !== null ? `+${money(draftSizing.value.projectedProfit, paperSnapshot.session.currency)}` : "—"}</strong>
              <span className="text-slate-500">{copy.paperTrading.netRewardRisk}</span><strong data-testid="draft-ratio" className="text-right font-mono font-semibold text-slate-900">{draftSizing?.ok && draftSizing.value.rewardRiskRatio !== null ? `${draftSizing.value.rewardRiskRatio.toFixed(2)}R` : "—"}</strong>
            </div>
            {!draftSizing?.ok ? <p className="text-xs text-red-600">{draftSizing ? sizingErrorText(draftSizing.error) : copy.paperTrading.invalidPrice}</p> : null}
            {draftError || paperError ? <p className="text-xs text-red-600">{draftError ?? paperError}</p> : null}
            <div className="grid grid-cols-[1fr_1.6fr] gap-2">
              <Button type="button" variant="outline" size="sm" disabled={paperBusy} onClick={() => { setDraft(null); setDraftError(null); setOrderTicketPosition(null); }}>{copy.paperTrading.cancelDraft}</Button>
              <Button type="button" size="sm" data-testid="confirm-risk-order" disabled={paperBusy || !draftSizing?.ok} onClick={() => void submitDraft()}>{paperBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{paperBusy ? copy.paperTrading.submitting : paperSnapshot.session.trainingGate?.active && !isClosingOrder(paperSnapshot.session.netQuantity, draft.side, draftSizing?.ok ? draftSizing.value.quantity : 0) ? copy.trainingGate.selectStrategy : copy.paperTrading.confirmDraft}</Button>
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
