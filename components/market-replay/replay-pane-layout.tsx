"use client";

import * as Popover from "@radix-ui/react-popover";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { layouts, paneIds, paneLayout, type LayoutId, type LayoutRatios, type PaneId, type PaneRect } from "@/lib/market-replay/multi-pane-layout";

type Preference = { template: LayoutId; ratios: LayoutRatios };
const defaultPreference: Preference = { template: "single", ratios: {} };

export function useReplayPaneLayout(temporarySingle: boolean, key = "market-replay-pane-layout-v1") {
  const [saved, setSaved] = useState(defaultPreference);
  const [loaded, setLoaded] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState<PaneId>(1);
  const [maximized, setMaximized] = useState<PaneId | null>(null);
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null") as Preference | null;
      if (value && Object.hasOwn(layouts, value.template)) {
        setSaved({ template: value.template, ratios: value.ratios ?? {} });
      }
    } catch { /* Current-page settings are still available. */ }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* Storage may be unavailable. */ }
  }, [key, loaded, saved]);
  useEffect(() => {
    if (!host) return;
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);
  const view = paneLayout(temporarySingle ? "single" : saved.template, size, saved.ratios, temporarySingle ? null : maximized);
  const activePane = view.panes.has(active) ? active : view.panes.keys().next().value ?? 1;
  useEffect(() => {
    if (active === activePane) return;
    setActive(activePane);
    if (document.activeElement === document.body) {
      host?.querySelector<HTMLElement>(`[data-replay-pane="${activePane}"] [data-drawing-nudge-chart]`)?.focus({ preventScroll: true });
    }
  }, [active, activePane, host]);
  function select(template: LayoutId) {
    setSaved(current => ({ ...current, template }));
    setMaximized(null);
    if (!paneLayout(template, size, saved.ratios, null).panes.has(active)) {
      setActive(1);
      requestAnimationFrame(() => host?.querySelector<HTMLElement>('[data-replay-pane="1"] [data-drawing-nudge-chart]')?.focus({ preventScroll: true }));
    }
  }
  function changeRatio(divider: string, ratio: number) {
    setSaved(current => ({ ...current, ratios: { ...current.ratios,
      [current.template]: { ...current.ratios[current.template], [divider]: ratio } } }));
  }
  function resetRatios() {
    setSaved(current => ({ ...current, ratios: { ...current.ratios, [current.template]: {} } }));
  }
  function toggleMaximize(pane: PaneId) {
    setActive(pane);
    setMaximized(current => current === pane ? null : pane);
  }
  return { ...view, measured: size.width > 0 && size.height > 0, activePane, maximized: temporarySingle || !view.fits ? null : maximized,
    template: saved.template, setHost, select, changeRatio, resetRatios, setActive, toggleMaximize };
}

const t = copy.marketReplay.multiPane;
const dividerHitSize = 8;
const previewSize = { width: 840, height: 560 };
const layoutPreviews = (Object.keys(layouts) as LayoutId[]).map(id => ({
  id, ...paneLayout(id, previewSize, {}, null),
}));

function ReplayLayoutPreview({ template }: { template: LayoutId }) {
  const { dividers } = layoutPreviews.find(preview => preview.id === template)!;
  return <span aria-hidden="true" className="relative block h-4 w-5 rounded-sm border border-current">
    {dividers.map(({ key, axis, rect }) => <span key={key} className="absolute bg-current" style={axis === "x" ? {
      left: rect.x / previewSize.width * 100 + "%", top: rect.y / previewSize.height * 100 + "%",
      width: 1, height: rect.height / previewSize.height * 100 + "%",
    } : {
      left: rect.x / previewSize.width * 100 + "%", top: rect.y / previewSize.height * 100 + "%",
      width: rect.width / previewSize.width * 100 + "%", height: 1,
    }} />)}
  </span>;
}

export function ReplayLayoutMenu({ template, disabled, onSelect, onReset }: {
  template: LayoutId; disabled: boolean; onSelect: (template: LayoutId) => Promise<void>; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = `${t.layout} · ${t.templates[template]}`;
  return <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
    <Popover.Trigger asChild><Button type="button" size="icon" variant="ghost" disabled={disabled} className="h-8 w-8 shrink-0"
      aria-label={label} title={label}>
      <ReplayLayoutPreview template={template} />
    </Button></Popover.Trigger>
    <Popover.Portal><Popover.Content align="end" sideOffset={4} collisionPadding={8} aria-label={t.layout}
      className="z-[80] max-h-[var(--radix-popover-content-available-height)] w-40 overflow-auto rounded-md border bg-surface-raised p-1 shadow-lg">
      <div className="divide-y divide-border">
        {paneIds.map(count => <div key={count} role="group" aria-label={t.paneCount(count)} className="flex items-center gap-1 px-1 py-0.5">
          <span aria-hidden="true" className="w-5 text-center text-xs tabular-nums text-muted-foreground">{count}</span>
          {layoutPreviews.filter(preview => preview.panes.size === count).map(({ id }) => <Button key={id} type="button"
            size="icon" variant={id === template ? "secondary" : "ghost"} className={`h-8 w-8 ${id === template ? "text-link" : ""}`}
            aria-label={t.templates[id]} title={t.templates[id]} aria-pressed={id === template}
            onClick={() => { setOpen(false); void onSelect(id); }}>
            <ReplayLayoutPreview template={id} />
          </Button>)}
        </div>)}
      </div>
      <div className="mt-1 border-t pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-8 w-full" onClick={() => { onReset(); setOpen(false); }}>{t.reset}</Button>
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

export function ReplayPaneDivider({ divider, onRatio }: {
  divider: ReturnType<typeof paneLayout>["dividers"][number]; onRatio: (ratio: number) => void;
}) {
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const horizontal = divider.axis === "x";
  const apply = (ratio: number) => onRatio(Math.max(divider.min, Math.min(divider.max, ratio)));
  const { x, y, width, height } = divider.rect;
  const hitBox = horizontal
    ? { left: x - (dividerHitSize - width) / 2, top: y, width: dividerHitSize, height }
    : { left: x, top: y - (dividerHitSize - height) / 2, width, height: dividerHitSize };
  return <div role="separator" tabIndex={0} aria-label={horizontal ? t.resizeWidth : t.resizeHeight}
    aria-orientation={horizontal ? "vertical" : "horizontal"}
    aria-valuemin={Math.round(divider.min * 100)} aria-valuemax={Math.round(divider.max * 100)} aria-valuenow={Math.round(divider.ratio * 100)}
    className={`group absolute z-10 grid touch-none place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${horizontal ? "cursor-col-resize" : "cursor-row-resize"}`}
    style={hitBox}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      stopDrag.current?.();
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const start = horizontal ? event.clientX : event.clientY;
      const resize = (move: PointerEvent) => {
        const position = horizontal ? move.clientX : move.clientY;
        apply(divider.ratio + (position - start) / divider.available);
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (e.buttons === 0) stop();
        else resize(e);
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (e.type === "pointerup") resize(e);
        stop();
      };
      function stop() {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", end, true);
        window.removeEventListener("pointercancel", end, true);
        window.removeEventListener("blur", stop);
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        stopDrag.current = null;
      }
      stopDrag.current = stop;
      handle.setPointerCapture(pointerId);
      handle.focus({ preventScroll: true });
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", end, true);
      window.addEventListener("pointercancel", end, true);
      window.addEventListener("blur", stop);
    }}
    onKeyDown={event => {
      const [decrease, increase] = horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
      if (event.key !== decrease && event.key !== increase) return;
      event.preventDefault();
      apply(divider.ratio + (event.key === decrease ? -.025 : .025));
    }}>
    <span aria-hidden="true" className="pointer-events-none bg-border group-hover:bg-primary" style={{ width, height }} />
  </div>;
}

export function ReplayPaneFrame({ pane, rect, active, title, showHeader, maximized, canMaximize, onActivate, onMaximize, children }: {
  pane: PaneId; rect: PaneRect; active: boolean; title: string; showHeader: boolean; maximized: boolean; canMaximize: boolean;
  onActivate: () => void; onMaximize: () => void; children: ReactNode;
}) {
  const maxLabel = maximized ? t.restore : t.maximize;
  return <section data-replay-pane={pane} aria-label={title}
    className={`absolute flex min-h-0 min-w-0 flex-col overflow-hidden bg-card ${showHeader ? "border" : ""} ${showHeader && active ? "border-primary" : ""}`}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    onFocusCapture={onActivate}
    onPointerDownCapture={onActivate}>
    {showHeader ? <header className="flex h-7 shrink-0 items-center justify-between border-b px-1">
      <Button size="sm" variant="ghost" className="h-6 min-w-0 px-2 text-xs" data-pane-activate
        aria-pressed={active} onClick={onActivate}><span className="truncate">{title}</span></Button>
      {canMaximize ? <Button size="icon" variant="ghost" className="h-6 w-7 shrink-0" aria-label={maxLabel} title={maxLabel} onClick={onMaximize}>
        {maximized ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
      </Button> : null}
    </header> : null}
    <div className="relative min-h-0 flex-1">{children}</div>
  </section>;
}
