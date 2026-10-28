"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { clampTradePanelWidth, parseTradePanelWidth, tradePanelMaximum, TRADE_PANEL_DEFAULT_WIDTH,
  TRADE_PANEL_MAX_WIDTH, TRADE_PANEL_MIN_WIDTH, TRADE_PANEL_WIDTH_KEY } from "./trade-panel-width";

export function ResizableTradePanel({ onClose, children, checking }: { onClose: () => void; children: ReactNode; checking: boolean }) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; startPreferred: number; width: number; moved: boolean } | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(TRADE_PANEL_DEFAULT_WIDTH);
  const [maximum, setMaximum] = useState(TRADE_PANEL_MAX_WIDTH);
  const width = clampTradePanelWidth(preferredWidth, maximum);

  useEffect(() => {
    try { setPreferredWidth(parseTradePanelWidth(window.localStorage.getItem(TRADE_PANEL_WIDTH_KEY))); }
    catch { /* The default remains usable if browser storage is unavailable. */ }
    const workspace = panelRef.current?.parentElement;
    if (!workspace) return;
    const measure = () => setMaximum(tradePanelMaximum(workspace.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  function saveWidth(next: number) {
    setPreferredWidth(next);
    try { window.localStorage.setItem(TRADE_PANEL_WIDTH_KEY, String(next)); }
    catch { /* The chosen width remains in memory for this visit. */ }
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, startPreferred: preferredWidth, width, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.clientX === drag.startX && !drag.moved) return;
    drag.moved = true;
    drag.width = clampTradePanelWidth(drag.startWidth + drag.startX - event.clientX, maximum);
    setPreferredWidth(drag.width);
  }
  function finishDrag(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) setPreferredWidth(drag.startPreferred); else if (drag.moved) saveWidth(drag.width);
  }
  function onResizeKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16;
    const next = event.key === "ArrowLeft" ? width + step : event.key === "ArrowRight" ? width - step
      : event.key === "Home" ? TRADE_PANEL_MIN_WIDTH : event.key === "End" ? maximum : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    saveWidth(clampTradePanelWidth(next, maximum));
  }

  return <aside ref={panelRef} id="replay-trade-panel" aria-label={copy.paperTrading.panelTitle}
    className="relative flex min-h-0 shrink-0 flex-col border-l bg-white" style={{ width }} inert={checking || undefined}>
    <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label={copy.paperTrading.resizeTradePanel} aria-controls="replay-trade-panel"
      aria-valuemin={TRADE_PANEL_MIN_WIDTH} aria-valuemax={maximum} aria-valuenow={width} title={copy.paperTrading.resizeTradePanelHint}
      className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-blue-600 focus-visible:after:bg-blue-600"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => finishDrag(event)}
      onPointerCancel={event => finishDrag(event, true)} onLostPointerCapture={event => finishDrag(event, true)} onKeyDown={onResizeKey} />
    <header className="flex shrink-0 items-center justify-between border-b px-4 py-2">
      <h2 className="text-sm font-semibold text-slate-950">{copy.paperTrading.panelTitle}</h2>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-500" aria-label={copy.paperTrading.closeTradePanel} onClick={onClose}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
  </aside>;
}
