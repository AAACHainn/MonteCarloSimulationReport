"use client";
import type { CreatePaperAccountInput } from "@/lib/prop-practice/account-input";
import { shouldStopPropReplay } from "@/lib/prop-practice/rules";

import { changeReplayDisplayInterval } from "./change-replay-display";
import { createUuid } from "@/lib/uuid";
import { type CorrectionTarget } from "./replay-correction-dialog";
import { isClosingOrder, type TrainingGateMode } from "@/lib/paper-trading/training-gate";
import type { GateApprovalInput, PaperOrderInput, OrderSubmitResult } from "@/lib/paper-trading/types";
import { retainEntryCheckDraft } from "@/lib/paper-trading/entry-check-draft";
import { startTransition, useCallback } from "react";
import { Loader2, X } from "lucide-react";
import { DEFAULT_REPLAY_MAX_VISIBLE_BARS } from "@/lib/market-replay/chart-range";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { setDisplaySession, setPlaybackRate } from "@/lib/market-replay/engine";
import { isValidBarCountInterval, isValidBarCountRecentTradingDays } from "@/lib/market-replay/bar-count";
import { DEFAULT_EMA_LINE_STYLE, DEFAULT_EMA_LINE_WIDTH } from "@/lib/market-replay/ema-style";
import { ABR_LENGTH_MAX, ABR_LENGTH_MIN, BAR_COUNT_INTERVAL_MAX, BAR_COUNT_INTERVAL_MIN, BAR_COUNT_RECENT_TRADING_DAYS_MAX, BAR_COUNT_RECENT_TRADING_DAYS_MIN, EMA_LENGTH_MAX, EMA_LENGTH_MIN, MAX_EMA_INDICATORS, MAX_REPLAY_BULK_SOURCE_BARS, REPLAY_HISTORY_BAR_LIMIT, isValidDisplayInterval, type DisplaySession, type ReplayState } from "@/lib/market-replay/types";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { paperOrderUrl } from "@/lib/paper-trading/order-url";
import { EMA_COLORS } from "@/components/market-replay/use-replay-preferences";
import { useDelayedActivity } from "@/lib/use-delayed-activity";
import { replayPlaybackStatusText } from "@/lib/market-replay/playback-status";
import { isValidEmaLength } from "./replay-client-shared";
import type { useReplayCore } from "./use-replay-core";
import type { useReplayDrawingWindow } from "./use-replay-drawing-window";
import type { useReplayEngine } from "./use-replay-engine";

export function useReplayActions(core: ReturnType<typeof useReplayCore>, drawingWindow: ReturnType<typeof useReplayDrawingWindow>, engine: ReturnType<typeof useReplayEngine>) {
  const {
    fetch, replaySession, router, setDateDialogOpen, dateDialogOpening, setDateDialogOpening,
    setDateDialogMinimum, dateForwarding, setDateForwarding, setForwardProgress, cancelForwardRef, setCorrectionTarget,
    correctionPending, dataset, retrying, setBars, setWarmupBars, currentSourceBar,
    isLoading, loadError, replay, setReplay, latestReplayRef, pauseReason,
    pausePlayback, autoPausePlayback, suspendPlayback, restorePlayback, capturePlaybackIntent, wantsPlayback,
    startValue, setStartDialogOpen, setStartDialogValue, startDialogBusy, setStartDialogBusy, startDialogSuspensionRef,
    confirmationSuspensionRef, setStartError, saveStatus, setSaveStatus, confirmAction, setConfirmAction,
    setEmaError, setAbrError, setBarCountError, paperSnapshot, paperSnapshotRef, confirmedPaperSnapshotRef,
    paperMutationActiveRef, paperMutationChainRef, pendingPaperMutationsRef, commitConfirmedPaperSnapshot, paperBusy, setPaperBusy,
    setPaperError, journalReview, setJournalReview, setChartFocusSequence, chartWindowDetachedRef, buffering,
    recoveryNotice, gateSettings, setGateSettings, setGateDialogOpen, gateBusy, setGateBusy,
    setGateError, gateNotice, setGateNotice, checkingOrder, setCheckingOrder, setEntryCheckDraft,
    chartDraftIdRef, preparingEntryCheckRef, checkResolverRef, emaIndicators, setEmaIndicators, abrLength,
    setAbrLength, setBarCountConfig, finishText, emaWarmupCount, indicatorWarmupCountRef, skipNextIndicatorReloadRef,
    manualStepsRef, barsRef, warmupBarsRef, recoveryRequiredRef, viewChangingRef, windowRequestRef,
    historyAbortRef, historyLoadingRef, historyHasEarlierRef, historyEpochRef, pendingSaveRef, saveTimerRef,
    saveChainRef, advanceCompletionRef, playbackAccumulatorRef, playbackClockRef,
  } = core;
  const {
    loadTradeAnnotations, loadWindow, loadEarlierHistory,
  } = drawingWindow;
  const {
    reloadPaper, queueSave, flushVisible, processServerBars, startReplayAt,
    returnToLiveWindow,
  } = engine;
  function changeSpeed(value: number) {
    const current = latestReplayRef.current;
    if (!current) return;
    const next = setPlaybackRate(current, value);
    setReplay(next);
    queueSave(next, true);
  }

  async function changeDisplayInterval(value: number): Promise<boolean> {
    if (!latestReplayRef.current || !dataset.sourceIntervalSeconds || !isValidDisplayInterval(dataset.sourceIntervalSeconds, value)) {
      setEmaError(copy.marketReplay.invalidDisplayInterval); return false;
    }
    return changeReplayDisplayInterval(core, { loadWindow, flushVisible, queueSave }, value);
  }

  async function changeChartSession(value: DisplaySession) {
    if (!latestReplayRef.current || !dataset.availableDisplaySessions.includes(value) || viewChangingRef.current) return;
    viewChangingRef.current = true;
    const suspension = suspendPlayback();
    manualStepsRef.current.cancel();
    let previous: ReplayState | null = null;
    try {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return;
      const current = latestReplayRef.current;
      if (!current) return;
      previous = current;
      playbackAccumulatorRef.current = 0;
      playbackClockRef.current = performance.now();
      const next = setDisplaySession(current, value);
      setReplay(next);
      setEmaError(null);
      queueSave(next, true);
      await saveChainRef.current;
      await loadWindow(next.currentSequence, next.displayIntervalSeconds, value, indicatorWarmupCountRef.current);
    } catch (error) {
      if (previous) {
        setReplay(previous);
        queueSave(previous, true);
      }
      setPaperError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    } finally {
      viewChangingRef.current = false;
      restorePlayback(suspension);
    }
  }

  function setEmaLength(id: string, value: number) {
    if (!isValidEmaLength(value)) {
      setEmaError(copy.marketReplay.emaLengthRange(EMA_LENGTH_MIN, EMA_LENGTH_MAX));
      return false;
    }
    setEmaIndicators((current) => current.map((indicator) => (
      indicator.id === id ? { ...indicator, length: value } : indicator
    )));
    setEmaError(null);
    return true;
  }

  function updateAbrLength(value: number) {
    if (!Number.isInteger(value) || value < ABR_LENGTH_MIN || value > ABR_LENGTH_MAX) {
      setAbrError(copy.marketReplay.abrLengthRange(ABR_LENGTH_MIN, ABR_LENGTH_MAX));
      return false;
    }
    if (value === abrLength) return true;
    setAbrError(null);
    manualStepsRef.current.cancel();
    const suspension = suspendPlayback();
    void (async () => {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return;
      skipNextIndicatorReloadRef.current = true;
      setAbrLength(value);
      const current = latestReplayRef.current;
      if (current) await loadWindow(current.currentSequence, current.displayIntervalSeconds, current.displaySession, Math.max(emaWarmupCount, value));
    })().catch((error) => {
      skipNextIndicatorReloadRef.current = true;
      setAbrLength(abrLength);
      setAbrError(error instanceof Error ? error.message : copy.marketReplay.loadError);
    }).finally(() => {
      restorePlayback(suspension);
    });
    return true;
  }

  function updateBarCountInterval(value: number) {
    if (!isValidBarCountInterval(value)) {
      setBarCountError(copy.marketReplay.barCountIntervalRange(BAR_COUNT_INTERVAL_MIN, BAR_COUNT_INTERVAL_MAX));
      return false;
    }
    setBarCountConfig((current) => ({ ...current, interval: value }));
    setBarCountError(null);
    return true;
  }

  function updateBarCountRecentTradingDays(value: number) {
    if (!isValidBarCountRecentTradingDays(value)) {
      setBarCountError(copy.marketReplay.barCountRecentTradingDaysRange(
        BAR_COUNT_RECENT_TRADING_DAYS_MIN,
        BAR_COUNT_RECENT_TRADING_DAYS_MAX,
      ));
      return false;
    }
    setBarCountConfig((current) => ({ ...current, recentTradingDays: value }));
    setBarCountError(null);
    return true;
  }

  function addEma() {
    if (emaIndicators.length >= MAX_EMA_INDICATORS) {
      setEmaError(copy.marketReplay.emaLimit(MAX_EMA_INDICATORS));
      return;
    }
    const preferredLengths = [20, 60, 200, 9, 12, 26, 50, 100];
    const length = preferredLengths.find((candidate) => !emaIndicators.some((item) => item.length === candidate)) ?? 20;
    setEmaIndicators((current) => [...current, {
      id: `ema-${Date.now()}`,
      length,
      color: EMA_COLORS[current.length % EMA_COLORS.length],
      lineWidth: DEFAULT_EMA_LINE_WIDTH,
      lineStyle: DEFAULT_EMA_LINE_STYLE,
      visible: true,
    }]);
    setEmaError(null);
  }

  function requestConfirmation(action: "reset" | "paper-clear") {
    const current = latestReplayRef.current;
    if (!current) return;
    confirmationSuspensionRef.current = suspendPlayback();
    setConfirmAction(action);
  }

  function openStartDialog() {
    const current = latestReplayRef.current;
    if (!current) return;
    startDialogSuspensionRef.current = suspendPlayback();
    setStartDialogValue(startValue);
    setStartError(null);
    setStartDialogOpen(true);
  }

  function closeStartDialog() {
    if (startDialogBusy) return;
    setStartDialogOpen(false);
    setStartError(null);
    const suspension = startDialogSuspensionRef.current;
    startDialogSuspensionRef.current = null;
    if (restorePlayback(suspension)) {
      playbackClockRef.current = performance.now();
    }
  }

  async function applyNewReplayStart(value: string) {
    if (!latestReplayRef.current || startDialogBusy) return;
    setStartDialogBusy(true);
    manualStepsRef.current.cancel();
    try {
      await advanceCompletionRef.current;
      if (!(await flushVisible())) return;
      windowRequestRef.current += 1;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      await saveChainRef.current.catch(() => undefined);
      // A failed in-flight save may have restored its draft while we waited.
      pendingSaveRef.current = null;
      if (await startReplayAt(value)) {
        setStartDialogOpen(false);
        setSaveStatus("idle");
      }
    } catch (error) {
      setStartError(error instanceof Error && error.message ? error.message : copy.marketReplay.loadError);
    } finally {
      setStartDialogBusy(false);
    }
  }

  async function applyConfirmedAction() {
    if (!latestReplayRef.current || !confirmAction) return;
    manualStepsRef.current.cancel();
    await advanceCompletionRef.current;
    if (!(await flushVisible())) {
      const suspension = confirmationSuspensionRef.current;
      confirmationSuspensionRef.current = null;
      restorePlayback(suspension);
      setConfirmAction(null);
      return;
    }
    windowRequestRef.current += 1;
    if (confirmAction === "paper-clear") {
      try {
        const response = await fetch(`/api/market-datasets/${dataset.id}/paper-session`, { method: "DELETE" });
        if (!response.ok) throw new Error(copy.paperTrading.requestFailed);
        pausePlayback();
        router.push(`/market-replay/${dataset.id}`);
      } catch {
        setPaperError(copy.paperTrading.requestFailed);
        try {
          await reloadPaper();
          const suspension = confirmationSuspensionRef.current;
          confirmationSuspensionRef.current = null;
          restorePlayback(suspension);
        } catch {
          autoPausePlayback("operation-failed");
          const suspension = confirmationSuspensionRef.current;
          confirmationSuspensionRef.current = null;
          restorePlayback(suspension);
        }
      }
    } else {
      const suspension = confirmationSuspensionRef.current;
      confirmationSuspensionRef.current = null;
      pausePlayback();
      restorePlayback(suspension);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      await saveChainRef.current.catch(() => undefined);
      // A failed in-flight save may have restored its draft while we waited.
      pendingSaveRef.current = null;
      const response = await fetch(`/api/market-datasets/${dataset.id}/replay/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESET" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setSaveStatus("error");
        setConfirmAction(null);
        return;
      }
      router.push(`/market-replay/${dataset.id}?sessionId=${encodeURIComponent(data.replaySessionId)}`);
    }
    setConfirmAction(null);
  }

  async function mutatePaper(url: string, createInit: (version: number | null) => RequestInit) {
    if (correctionPending || dateForwarding) { setPaperError(copy.replaySessions.busy); return false; }
    if (chartWindowDetachedRef.current && !await returnToLiveWindow()) return false;
    pendingPaperMutationsRef.current += 1;
    setPaperBusy(true);
    setPaperError(null);
    const operation = paperMutationChainRef.current.catch(() => undefined).then(async () => {
      const operationIntent = capturePlaybackIntent();
      const suspension = suspendPlayback();
      manualStepsRef.current.cancel();
      paperMutationActiveRef.current = true;
      await advanceCompletionRef.current.catch(() => undefined);
      try {
        if (!(await flushVisible())) return false;
        const version = confirmedPaperSnapshotRef.current?.session.version ?? null;
        const response = await fetch(url, createInit(version));
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 409) await reloadPaper();
          throw new Error(data?.error ?? copy.paperTrading.requestFailed);
        }
        if (data.snapshot !== undefined) {
          const snapshot = data.snapshot as PaperSessionSnapshot | null;
          const previousFillId = confirmedPaperSnapshotRef.current?.recentFills[0]?.id;
          commitConfirmedPaperSnapshot(snapshot);
          if (snapshot?.recentFills[0]?.id && snapshot.recentFills[0].id !== previousFillId) {
            void loadTradeAnnotations(barsRef.current.slice(-DEFAULT_REPLAY_MAX_VISIBLE_BARS));
          }
        }
        return true;
      } catch (error) {
        setPaperError(error instanceof Error ? error.message : copy.paperTrading.requestFailed);
        try {
          await reloadPaper();
        } catch {
          recoveryRequiredRef.current = true;
          autoPausePlayback("operation-failed", operationIntent);
        }
        return false;
      } finally {
        paperMutationActiveRef.current = false;
        if (restorePlayback(suspension)) {
          playbackClockRef.current = performance.now();
        }
      }
    });
    paperMutationChainRef.current = operation.then(() => undefined, () => undefined);
    return operation.finally(() => {
      pendingPaperMutationsRef.current -= 1;
      if (pendingPaperMutationsRef.current === 0) setPaperBusy(false);
    });
  }

  function openCorrectionTarget(target: CorrectionTarget) {
    if (correctionPending) return;
    pausePlayback(); manualStepsRef.current.cancel(); setCorrectionTarget(target);
  }

  async function openDateDialog() {
    if (dateDialogOpening || correctionPending || dateForwarding || viewChangingRef.current) return;
    setDateDialogOpening(true);
    try {
      if (!await prepareSessionSwitch()) return;
      const current = latestReplayRef.current;
      if (!current || !replaySession) return;
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(replaySession.id)}/locate?sequence=${current.currentSequence}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
      setDateDialogMinimum(data.minTimestamp);
      setDateDialogOpen(true);
    } catch (error) {
      setPaperError(error instanceof Error ? error.message : copy.replaySessions.requestFailed);
    } finally { setDateDialogOpening(false); }
  }

  async function locateReplayDate(timestamp: string, forward: boolean) {
    if (correctionPending || dateForwarding || viewChangingRef.current) return false;
    if (!await prepareSessionSwitch()) return false;
    const response = await fetch(`/api/replay-sessions/${encodeURIComponent(replaySession!.id)}/locate?timestamp=${encodeURIComponent(timestamp)}${forward ? "&direction=FORWARD" : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? copy.replaySessions.requestFailed);
    if (!forward) return locateChartDate(data.sequence);
    setDateDialogOpen(false); setJournalReview(null); setChartFocusSequence(null); setDateForwarding(true); cancelForwardRef.current = false;
    try {
      while ((latestReplayRef.current?.currentSequence ?? data.sequence) < data.sequence && !cancelForwardRef.current) {
        const current = latestReplayRef.current!;
        const processed = await processServerBars(Math.min(MAX_REPLAY_BULK_SOURCE_BARS, data.sequence - current.currentSequence), () => !cancelForwardRef.current, undefined, true);
        if (!processed || !await flushVisible()) return false;
        const prop = confirmedPaperSnapshotRef.current?.propAccount?.state;
        if (prop && shouldStopPropReplay(prop)) return false;
        setForwardProgress({ current: latestReplayRef.current!.currentSequence, target: data.sequence });
      }
      return true;
    } finally { await flushVisible(); setDateForwarding(false); setForwardProgress(null); pausePlayback(); }
  }

  async function prepareSessionSwitch() {
    if (!await finishText()) return false;
    cancelForwardRef.current = true; pausePlayback(); manualStepsRef.current.cancel();
    await paperMutationChainRef.current; await advanceCompletionRef.current;
    pausePlayback(); return flushVisible();
  }

  async function locateChartDate(sequence: number) {
    if ((journalReview || chartWindowDetachedRef.current) && !await returnToLiveWindow()) return false;
    const current = latestReplayRef.current;
    if (!current || viewChangingRef.current) return false;
    viewChangingRef.current = true;
    historyEpochRef.current += 1;
    historyAbortRef.current?.abort();
    historyAbortRef.current = null;
    historyLoadingRef.current = false;
    try {
      // Keep the current chart and its revealed right edge. Only extend the
      // existing history when the requested candle is not already loaded.
      while ((barsRef.current[0]?.firstSequence ?? 0) > sequence
        && barsRef.current.length < REPLAY_HISTORY_BAR_LIMIT && historyHasEarlierRef.current) {
        const previousFirst = barsRef.current[0].firstSequence;
        await loadEarlierHistory();
        if ((barsRef.current[0]?.firstSequence ?? previousFirst) >= previousFirst) break;
      }
      if ((barsRef.current[0]?.firstSequence ?? 0) > sequence && historyHasEarlierRef.current) {
        // Very distant dates need a bounded window; ordinary navigation keeps
        // its existing candles and does not enter journal review mode.
        await loadWindow(current.currentSequence, current.displayIntervalSeconds, current.displaySession,
          indicatorWarmupCountRef.current, null, sequence, true);
        chartWindowDetachedRef.current = true;
      }
      if (!barsRef.current.length) return false;
      startTransition(() => {
        setBars(barsRef.current);
        setWarmupBars(warmupBarsRef.current);
        setChartFocusSequence(sequence);
      });
      return true;
    } finally { viewChangingRef.current = false; }
  }

  async function createPaperAccount(config: CreatePaperAccountInput) {
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session`, () => ({
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
    }));
  }

  async function sendPaperOrder(order: PaperOrderInput, gateApproval?: GateApprovalInput) {
    if (!paperSnapshotRef.current) return false;
    // Capture before mutatePaper temporarily suspends automatic playback.
    const executeAtCurrentClose = order.type === "MARKET" && order.reduceOnly === true && !wantsPlayback();
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders`, (version) => ({
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...order, executeAtCurrentClose, gateApproval, expectedVersion: version }),
    }));
  }

  const onChartDraftChange = useCallback((draftId: string | null) => {
    chartDraftIdRef.current = draftId;
    setEntryCheckDraft((current) => current && current.draftId !== draftId ? null : current);
  }, [chartDraftIdRef, setEntryCheckDraft]);

  async function submitPaperOrder(order: PaperOrderInput, draftId?: string): Promise<OrderSubmitResult> {
    const snapshot = paperSnapshotRef.current;
    if (!snapshot || checkingOrder || checkResolverRef.current || preparingEntryCheckRef.current) return "CANCELLED";
    const closing = order.reduceOnly || isClosingOrder(snapshot.session.netQuantity, order.side, order.quantity);
    if (replaySession?.mode === "TRAINING" && snapshot.session.trainingGate?.active && !closing) {
      const fromChart = draftId !== undefined && chartDraftIdRef.current === draftId;
      preparingEntryCheckRef.current = true;
      try {
        if (!await prepareSessionSwitch()) return "FAILED";
        if (fromChart && chartDraftIdRef.current !== draftId) return "CANCELLED";
      } finally { preparingEntryCheckRef.current = false; }
      setPaperError(null);
      const checkDraftId = draftId ?? createUuid();
      setEntryCheckDraft((current) => retainEntryCheckDraft(current, checkDraftId));
      return new Promise<OrderSubmitResult>((resolve) => { checkResolverRef.current = resolve; setCheckingOrder({ order: { ...order }, draftId: checkDraftId }); });
    }
    return await sendPaperOrder(order) ? "SUCCESS" : "FAILED";
  }

  function cancelEntryCheck() {
    if (paperBusy) return;
    setCheckingOrder(null); setPaperError(null);
    const resolve = checkResolverRef.current; checkResolverRef.current = null; resolve?.("CANCELLED");
  }
  async function confirmEntryCheck(approval: GateApprovalInput) {
    if (!checkingOrder || paperBusy) return false;
    const success = await sendPaperOrder(checkingOrder.order, approval);
    if (success) {
      setCheckingOrder(null);
      setEntryCheckDraft(null);
      const resolve = checkResolverRef.current; checkResolverRef.current = null; resolve?.("SUCCESS");
    }
    return success;
  }

  async function openGateConfig() {
    if (!replaySession || gateBusy || checkingOrder) return;
    setGateBusy(true); setGateError(null);
    try {
      if (!await prepareSessionSwitch()) throw new Error(copy.replaySessions.switchFailed);
      const response = await fetch(`/api/replay-sessions/${replaySession.id}/training-gate`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.trainingGate.failed);
      setGateSettings(data.gate); setGateDialogOpen(true);
    } catch (error) { setGateNotice(error instanceof Error ? error.message : copy.trainingGate.failed); }
    finally { setGateBusy(false); }
  }
  async function saveGateConfig(config: { tradeCount: number; autoEnabled: boolean; lossThreshold: number; nextMode: TrainingGateMode }, start: boolean) {
    if (!replaySession || gateBusy) return;
    setGateBusy(true); setGateError(null);
    try {
      const current = await fetch(`/api/replay-sessions/${replaySession.id}/training-gate`, { cache: "no-store" });
      const latest = await current.json();
      if (!current.ok) throw new Error(latest.error ?? copy.trainingGate.failed);
      const response = await fetch(`/api/replay-sessions/${replaySession.id}/training-gate`, { method: start ? "POST" : "PUT", headers: { "Content-Type": "application/json", "X-Replay-Projection": replaySession.activeProjectionId }, body: JSON.stringify({ ...config, expectedVersion: latest.version }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.trainingGate.failed);
      setGateSettings(data.gate); commitConfirmedPaperSnapshot(data.snapshot);
      setGateNotice(start ? `${copy.trainingGate.manual} · ${copy.trainingGate.cancelled(data.gate.cancelledOrderCount)}` : copy.trainingGate.saved);
      setGateDialogOpen(false);
    } catch (error) { setGateError(error instanceof Error ? error.message : copy.trainingGate.failed); }
    finally { setGateBusy(false); }
  }
  const currentGate = paperSnapshot?.session.trainingGate ?? gateSettings;
  const gateButton = replaySession?.mode === "TRAINING" ? <Button variant="outline" size="sm" className="h-10 md:h-9" title={copy.trainingGate.autoStatus(currentGate.autoEnabled, currentGate.lossThreshold, currentGate.lossStreak)} disabled={gateBusy || isLoading || Boolean(loadError) || !replay || Boolean(checkingOrder) || Boolean(journalReview)} onClick={() => void openGateConfig()}>{gateBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{currentGate.active ? copy.trainingGate.remaining(currentGate.targetCount - currentGate.completedCount) : copy.trainingGate.title}</Button> : null;

  const gateNoticeBlock = gateNotice ? <div className="flex shrink-0 items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status"><span>{gateNotice}</span><Button variant="ghost" size="icon" aria-label={copy.common.cancel} onClick={() => setGateNotice(null)}><X className="h-4 w-4" /></Button></div> : null;

  async function updatePaperOrder(orderId: string, update: { price?: number; quantity?: number; stopLoss?: number | null; takeProfit?: number | null; riskAmount?: number | null }) {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(paperOrderUrl(dataset.id, orderId), (version) => ({
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...update, expectedVersion: version }),
    }));
  }

  async function cancelPaperOrder(orderId: string) {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(paperOrderUrl(dataset.id, orderId), (version) => ({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version }),
    }));
  }

  async function cancelPaperScope(scope: "ALL" | "BRACKET") {
    if (!paperSnapshotRef.current) return false;
    return mutatePaper(`/api/market-datasets/${dataset.id}/paper-session/orders`, (version) => ({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version, scope }),
    }));
  }

  async function closePaperPosition() {
    const quantity = Math.abs(paperSnapshotRef.current?.session.netQuantity ?? 0);
    if (quantity <= 0) return false;
    return await submitPaperOrder({
      side: Number(paperSnapshotRef.current?.session.netQuantity) > 0 ? "SELL" : "BUY",
      type: "MARKET",
      quantity,
      price: null,
      stopLoss: null,
      takeProfit: null,
      reduceOnly: true,
    }) === "SUCCESS";
  }

  const currentBar = replay && replay.currentSequence >= 0 ? currentSourceBar : null;
  const revealedCount = replay ? Math.max(0, replay.currentSequence - replay.startSequence + 1) : 0;
  const replayCount = replay ? replay.barCount - replay.startSequence : 0;
  const activityVisible = useDelayedActivity(saveStatus === "saving" || buffering || pauseReason === "operation");
  const statusText = replayPlaybackStatusText({
    retrying, playbackRequested: wantsPlayback(), recoveryNotice, buffering, saveStatus,
    activityVisible, replayStatus: replay?.status, pauseReason,
  });

  return {
    changeSpeed, changeDisplayInterval, changeChartSession, setEmaLength, updateAbrLength, updateBarCountInterval,
    updateBarCountRecentTradingDays, addEma, requestConfirmation, openStartDialog, closeStartDialog, applyNewReplayStart,
    applyConfirmedAction, openCorrectionTarget, openDateDialog, locateReplayDate, prepareSessionSwitch, createPaperAccount,
    onChartDraftChange, submitPaperOrder, cancelEntryCheck, confirmEntryCheck, saveGateConfig, currentGate,
    gateButton, gateNoticeBlock, updatePaperOrder, cancelPaperOrder, cancelPaperScope, closePaperPosition,
    currentBar, revealedCount, replayCount, statusText,
  };
}
