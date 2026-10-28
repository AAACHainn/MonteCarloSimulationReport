"use client";

import { useId, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowBigDown, ArrowBigUp, ListTree, Maximize, Minimize, Ruler, Square, TrendingUp, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { DRAWING_TYPE_ARROW_DOWN, DRAWING_TYPE_ARROW_UP, DRAWING_TYPE_FIB_RETRACEMENT,
  DRAWING_TYPE_RECTANGLE, DRAWING_TYPE_TEXT, DRAWING_TYPE_TREND_LINE, type DrawingTool } from "@/lib/market-replay/chart-drawings";
import { useReplayShortcuts } from "./use-replay-shortcuts";
import { ReplayCursorMenu } from "./replay-cursor-menu";
import type { ReplayCursorMode } from "@/lib/market-replay/cursor-mode";

function ToolButton({ label, hint, active, disabled, onClick, shortcut, children }: {
  label: string; hint?: string; active: boolean; disabled?: boolean; onClick: () => void;
  shortcut?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild>
      <Button type="button" size="icon" variant="ghost"
        className={`h-9 w-9 shrink-0 ${active ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : ""}`} aria-label={label} aria-pressed={active} aria-keyshortcuts={shortcut}
        aria-describedby={open ? tooltipId : undefined}
        disabled={disabled} onClick={onClick} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>{children}</Button>
    </Popover.Anchor>
    <Popover.Portal>
      <Popover.Content id={tooltipId} role="tooltip" side="right" align="center" sideOffset={8} collisionPadding={8}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        className="pointer-events-none z-[80] max-w-[calc(100vw-1rem)] rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white shadow-lg">
        {label}{hint ? <span className="ml-2 text-slate-300">{hint}</span> : null}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

export function ReplayDrawingToolbar({ cursorMode, onCursorChange, drawingTool, drawingDisabled, onArmDrawing, measurementArmed,
  onToggleMeasurement, drawingObjectsOpen, onToggleDrawingObjects, webFullscreen, onToggleWebFullscreen }: {
  cursorMode: ReplayCursorMode; onCursorChange: (mode: ReplayCursorMode) => void;
  drawingTool: DrawingTool | null; drawingDisabled?: boolean; onArmDrawing: (tool: DrawingTool) => void;
  measurementArmed: boolean; onToggleMeasurement: () => void; drawingObjectsOpen: boolean; onToggleDrawingObjects: () => void;
  webFullscreen?: boolean; onToggleWebFullscreen?: () => void;
}) {
  const shortcuts = useReplayShortcuts();
  const tools: { type: DrawingTool; label: string; hint?: string; shortcut?: string; icon: ReactNode }[] = [
    { type: DRAWING_TYPE_TREND_LINE, label: copy.marketReplay.trendLine, hint: shortcuts.trendLine, shortcut: "Alt+T", icon: <TrendingUp className="h-4 w-4" aria-hidden="true" /> },
    { type: DRAWING_TYPE_ARROW_UP, label: copy.marketReplay.arrowUp, icon: <ArrowBigUp className="h-4 w-4" aria-hidden="true" /> },
    { type: DRAWING_TYPE_ARROW_DOWN, label: copy.marketReplay.arrowDown, icon: <ArrowBigDown className="h-4 w-4" aria-hidden="true" /> },
    { type: DRAWING_TYPE_FIB_RETRACEMENT, label: copy.marketReplay.fibonacciRetracement, hint: shortcuts.fibonacciRetracement, shortcut: "Alt+F", icon: <span className="flex h-4 w-4 items-center justify-center font-mono text-[10px] font-bold" aria-hidden="true">Fib</span> },
    { type: DRAWING_TYPE_RECTANGLE, label: copy.marketReplay.rectangle, hint: shortcuts.rectangle, shortcut: "Shift+R", icon: <Square className="h-4 w-4" aria-hidden="true" /> },
    { type: DRAWING_TYPE_TEXT, label: copy.marketReplay.textTool, hint: copy.marketReplay.textShortcut, shortcut: "Shift+T", icon: <Type className="h-4 w-4" aria-hidden="true" /> },
  ];
  return <nav aria-label={copy.marketReplay.drawingTools} className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r bg-white py-2">
    <ReplayCursorMenu value={cursorMode} onChange={onCursorChange} />
    <div className="my-1 h-px w-7 shrink-0 bg-slate-200" />
    {tools.map(tool => <ToolButton key={tool.type} label={tool.label} hint={tool.hint} shortcut={tool.shortcut}
      active={drawingTool === tool.type} disabled={drawingDisabled} onClick={() => onArmDrawing(tool.type)}>{tool.icon}</ToolButton>)}
    <ToolButton label={copy.marketReplay.measureHint} active={measurementArmed} onClick={onToggleMeasurement}>
      <Ruler className="h-4 w-4" aria-hidden="true" />
    </ToolButton>
    <div className="my-1 h-px w-7 shrink-0 bg-slate-200" />
    <ToolButton label={copy.marketReplay.drawingObjects} hint={copy.marketReplay.drawingDeleteShortcutHint(shortcuts.deleteDrawing)} active={drawingObjectsOpen} onClick={onToggleDrawingObjects}>
      <ListTree className="h-4 w-4" aria-hidden="true" />
    </ToolButton>
    {onToggleWebFullscreen ? <div className="mt-auto shrink-0 pt-2">
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9"
        aria-label={webFullscreen ? copy.marketReplay.exitWebFullscreen : copy.marketReplay.enterWebFullscreen}
        title={webFullscreen ? copy.marketReplay.webFullscreenExitHint : copy.marketReplay.enterWebFullscreen}
        aria-pressed={Boolean(webFullscreen)} onClick={onToggleWebFullscreen}>
        {webFullscreen ? <Minimize className="h-4 w-4" aria-hidden="true" /> : <Maximize className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </div> : null}
  </nav>;
}
