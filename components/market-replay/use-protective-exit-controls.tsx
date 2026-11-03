"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { copy } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { formatPriceForTick, snapPriceToTick } from "@/lib/market-replay/price-ticks";
import { defaultPartialExitQuantity, isValidProtectivePrice, protectiveOrderLabel } from "@/lib/paper-trading/protective-orders";
import type { PaperOrderData, PaperSessionSnapshot } from "@/lib/paper-trading/types";
import type { OrderUpdate } from "./replay-chart-shared";
import type { useReplayChartCore } from "./use-replay-chart-core";

type Preview = { price: number; quantity: number; y: number; label: string; valid: boolean; stop: boolean };
type Selection = { order: PaperOrderData; creating: boolean; scope: string };
type Drag = {
  pointerId: number; element: HTMLElement; sourceId: string; scope: string; startY: number; moved: boolean;
  price: number; quantity: number; valid: boolean; ready: Promise<PaperSessionSnapshot | null>;
};

export function useProtectiveExitControls(core: ReturnType<typeof useReplayChartCore>) {
  const current = useRef(core);
  current.current = core;
  const drag = useRef<Drag | null>(null);
  const mounted = useRef(true);
  const opening = useRef(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  function setNotice(message: string | null, error = false) { setFeedback(message === null ? null : { message, error }); }

  const clearDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    if (active?.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    setPreview(null);
    current.current.setProtectiveEditing(false);
  }, []);
  function close() { setSelection(null); current.current.setProtectiveEditing(false); }

  useEffect(() => {
    mounted.current = true;
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape" && drag.current) { event.preventDefault(); clearDrag(); } };
    const blur = () => { if (drag.current) clearDrag(); };
    window.addEventListener("keydown", cancel); window.addEventListener("blur", blur);
    return () => { mounted.current = false; drag.current = null; window.removeEventListener("keydown", cancel); window.removeEventListener("blur", blur); };
  }, [clearDrag]);
  useEffect(() => { clearDrag(); setSelection(null); setNotice(null); }, [core.visibilityScope, clearDrag]);

  async function prepare() {
    const c = current.current;
    return c.onPrepareProtectiveEdit ? c.onPrepareProtectiveEdit() : c.paperSnapshot;
  }

  async function openSettings(orderId: string) {
    const c = current.current;
    if (c.readOnly || c.paperBusy || c.entryCheckOpen || c.draft || opening.current || drag.current) return;
    opening.current = true;
    const scope = c.visibilityScope;
    c.setProtectiveEditing(true); setNotice(null);
    try {
      const snapshot = await prepare();
      if (!mounted.current || current.current.visibilityScope !== scope) return;
      const order = snapshot?.activeOrders.find((item) => item.id === orderId && item.isProtective);
      if (!order) { setNotice(copy.paperTrading.exitOrderUnavailable, true); c.setProtectiveEditing(false); return; }
      setSelection({ order, creating: false, scope });
    } catch { if (mounted.current) { setNotice(copy.paperTrading.exitReadyFailed, true); c.setProtectiveEditing(false); } }
    finally { opening.current = false; }
  }

  function begin(event: ReactPointerEvent<HTMLElement>, orderId: string) {
    const c = current.current;
    if (event.button !== 0 || c.readOnly || c.paperBusy || c.entryCheckOpen || c.draft || opening.current || drag.current || !c.onCreatePartialExit) return;
    const order = c.paperSnapshot?.activeOrders.find((item) => item.id === orderId && item.isProtective);
    if (!order || !c.paperSnapshot) return;
    event.preventDefault(); event.stopPropagation();
    c.setContextMenu(null); c.setProtectiveEditing(true); setNotice(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const ready = prepare().catch(() => null);
    drag.current = { pointerId: event.pointerId, element: event.currentTarget, sourceId: orderId, scope: c.visibilityScope,
      startY: event.clientY, moved: false, valid: false, price: Number(order.price), quantity: defaultPartialExitQuantity(c.paperSnapshot.session.netQuantity), ready };
    const started = drag.current;
    void ready.then(snapshot => {
      if (!snapshot || !mounted.current || drag.current !== started) return;
      started.quantity = defaultPartialExitQuantity(snapshot.session.netQuantity);
      setPreview(value => value ? { ...value, quantity: started.quantity,
        label: copy.paperTrading.exitPreview(protectiveOrderLabel(order), formatNumber(started.quantity), formatPriceForTick(value.price, c.priceTickSize)) } : value);
    });
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const active = drag.current, c = current.current;
    if (!active || active.pointerId !== event.pointerId || active.scope !== c.visibilityScope) return;
    event.preventDefault(); event.stopPropagation();
    const rect = c.containerRef.current?.getBoundingClientRect();
    const series = c.candleRef.current;
    if (!rect || !series) return;
    active.moved ||= Math.abs(event.clientY - active.startY) >= 6;
    if (!active.moved) return;
    const y = event.clientY - rect.top;
    const raw = series.coordinateToPrice(y as never);
    const price = raw === null ? NaN : snapPriceToTick(Number(raw), c.priceTickSize);
    const order = c.paperSnapshot?.activeOrders.find((item) => item.id === active.sourceId);
    active.price = price;
    const inside = y >= 0 && y <= (c.chartRef.current?.panes()[0]?.getHeight() ?? rect.height);
    const valid = inside && !!order && c.currentPrice !== null && isValidProtectivePrice(c.paperSnapshot?.session.netQuantity ?? 0, order.type, price, c.currentPrice);
    active.valid = valid;
    setPreview({ price, quantity: active.quantity, y: Math.max(0, Math.min(rect.height, y)), valid, stop: order?.type === "STOP",
      label: copy.paperTrading.exitPreview(order ? protectiveOrderLabel(order) : "", formatNumber(active.quantity), Number.isFinite(price) ? formatPriceForTick(price, c.priceTickSize) : copy.common.dash) });
  }

  async function end(event: ReactPointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const moved = active.moved;
    clearDrag();
    if (!moved) { await openSettings(active.sourceId); return; }
    const snapshot = await active.ready;
    const c = current.current;
    if (!mounted.current || active.scope !== c.visibilityScope) return;
    const source = snapshot?.activeOrders.find((order) => order.id === active.sourceId);
    if (!active.valid || !snapshot || !source || c.currentPrice === null || !isValidProtectivePrice(snapshot.session.netQuantity, source.type, active.price, c.currentPrice)) {
      setNotice(copy.paperTrading.invalidBracket, true); return;
    }
    const quantity = defaultPartialExitQuantity(snapshot.session.netQuantity);
    await c.onCreatePartialExit?.({ sourceOrderId: source.id, price: active.price, quantity });
  }

  const visibleSelection = selection?.scope === core.visibilityScope ? selection : null;
  const selectedOrder = visibleSelection ? core.paperSnapshot?.activeOrders.find((order) => order.id === visibleSelection.order.id) : null;

  async function save(update: OrderUpdate) {
    const c = current.current;
    if (!visibleSelection || visibleSelection.scope !== c.visibilityScope || !selectedOrder) return false;
    const saved = visibleSelection.creating
      ? await c.onCreatePartialExit?.({ sourceOrderId: selectedOrder.id, price: Number(update.price), quantity: Number(update.quantity) })
      : await c.onOrderPriceChangeRef.current(selectedOrder.id, update);
    return Boolean(saved);
  }

  return { selection: visibleSelection, selectedOrder, preview, notice: feedback?.message ?? null, noticeError: feedback?.error ?? false, openSettings, begin, move, end, cancel: clearDrag, close, save,
    add: () => { if (visibleSelection && selectedOrder) setSelection({ ...visibleSelection, order: selectedOrder, creating: true }); } };
}
