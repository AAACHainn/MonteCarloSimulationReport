"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OptionPopoverContent } from "@/components/ui/option-popover";
import { copy } from "@/lib/i18n";
import type { DrawingType } from "@/lib/market-replay/chart-drawings";
import { drawingShortcutConflict, drawingTemplateShortcut, formatDrawingTemplateShortcut, sameDrawingTemplateShortcut } from "@/lib/market-replay/drawing-template-shortcuts";
import { recordDrawingShortcut } from "./drawing-shortcut-recorder";
import { setDrawingTemplateBinding, useDrawingTemplateBindings } from "./use-drawing-template-bindings";
import { useReplayShortcuts } from "./use-replay-shortcuts";

type Template = { id: string; name: string };
export function DrawingTemplatePicker({ id, type, value, templates, onChange }: {
  id: string; type: DrawingType; value: string; templates: readonly Template[]; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [boundary, setBoundary] = useState<HTMLElement | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const errorId = useId();
  const bindings = useDrawingTemplateBindings();
  const { platform } = useReplayShortcuts();
  const stop = useRef<(() => void) | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const preserveOutsideFocus = useRef(false);
  const latest = useRef({ templates, bindings, platform, type });
  latest.current = { templates, bindings, platform, type };
  const t = copy.marketReplay.templateShortcuts;
  function cancel() { stop.current?.(); stop.current = null; setRecording(null); setError(null); }
  useEffect(() => () => { stop.current?.(); }, []);
  useEffect(() => {
    if (!open) return;
    // Dialogs and other controls may consume later mouse events. Detect the
    // outside pointer before them without consuming the control's own action.
    const outside = (event: PointerEvent) => {
      const target = event.target;
      const label = target instanceof Element ? target.closest<HTMLLabelElement>("label") : null;
      if (!(target instanceof Node) || content.current?.contains(target) || trigger.current?.contains(target)
        || trigger.current && label?.control === trigger.current) return;
      preserveOutsideFocus.current = target instanceof Element && Boolean(target.closest(
        "button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1']), [contenteditable]:not([contenteditable='false'])",
      ) || label?.control);
      stop.current?.(); stop.current = null; setRecording(null); setError(null);
      setBoundary(null); setOpen(false);
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open]);
  function start(template: Template) {
    cancel(); setStatus(""); setRecording(template.id);
    stop.current = recordDrawingShortcut(event => {
      const current = latest.current;
      if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(event.key)) return;
      const shortcut = drawingTemplateShortcut(event);
      if (!shortcut || event.getModifierState?.("AltGraph")) { setError(t.unsupported); return; }
      const conflict = drawingShortcutConflict(shortcut, current.platform);
      if (conflict) {
        const toolNames: Record<string, string> = { TREND_LINE: copy.marketReplay.trendLine, FIB_RETRACEMENT: copy.marketReplay.fibonacciRetracement,
          RECTANGLE: copy.marketReplay.rectangle, TEXT: copy.marketReplay.textTool, AB_CD: copy.marketReplay.abcd };
        setError(conflict.kind === "tool" ? t.toolConflict(toolNames[conflict.tool])
          : conflict.kind === "playback" ? conflict.key === "ArrowRight" ? t.stepConflict : t.playbackConflict
            : conflict.kind === "interval" ? t.intervalConflict : conflict.kind === "delete" ? t.deleteConflict : t.reserved);
        return;
      }
      if (!current.templates.some(item => item.id === template.id)) { cancel(); return; }
      const duplicate = current.templates.find(item => item.id !== template.id && current.bindings[current.type]?.[item.id]
        && sameDrawingTemplateShortcut(current.bindings[current.type]![item.id], shortcut));
      if (duplicate) { setError(t.templateConflict(duplicate.name)); return; }
      const saved = setDrawingTemplateBinding(current.type, template.id, shortcut);
      cancel(); setStatus(saved ? t.saved : t.storageUnavailable);
      controls.current.get(template.id)?.focus();
    }, () => { stop.current = null; setRecording(null); setError(null); });
  }
  const selected = templates.find(template => template.id === value);
  return <Popover.Root open={open} onOpenChange={next => {
    if (!next) cancel();
    if (next) preserveOutsideFocus.current = false;
    setBoundary(next ? trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? null : null);
    setOpen(next);
  }} modal>
    <Popover.Trigger asChild>
      <Button ref={trigger} id={id} type="button" variant="outline" className="min-w-0 flex-1 justify-between font-normal">
        <span className="truncate">{selected?.name ?? (templates.length ? copy.marketReplay.chooseDrawingTemplate : copy.marketReplay.noDrawingTemplates)}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 dark:text-muted-foreground" aria-hidden="true" />
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <OptionPopoverContent ref={content} data-drawing-template-picker aria-label={copy.marketReplay.drawingTemplate}
        className="w-[min(20rem,calc(var(--radix-popover-trigger-width)+3rem))] p-1"
        collisionBoundary={boundary ?? undefined} collisionPadding={8}
        onKeyDown={event => event.stopPropagation()}
        onCloseAutoFocus={event => { if (preserveOutsideFocus.current) event.preventDefault(); }}
        onOpenAutoFocus={event => { event.preventDefault(); controls.current.get(value || templates[0]?.id)?.focus(); }}>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {templates.length ? templates.map(template => {
            const shortcut = bindings[type]?.[template.id];
            const active = recording === template.id;
            return <div key={template.id} className="rounded-md focus-within:bg-slate-50 dark:focus-within:bg-hover">
              <div className="flex min-w-0 items-center gap-1">
                <Button ref={element => { if (element) controls.current.set(template.id, element); else controls.current.delete(template.id); }}
                  type="button" variant="ghost" className="min-w-0 flex-1 justify-start gap-1 px-2 font-normal" aria-pressed={value === template.id}
                  onClick={() => { cancel(); onChange(template.id); setOpen(false); }} title={template.name}>
                  <Check className={`h-4 w-4 shrink-0 ${value === template.id ? "" : "invisible"}`} aria-hidden="true" />
                  <span className="truncate">{template.name}</span>
                </Button>
                <Button type="button" variant="ghost" size="icon" className="shrink-0" title={shortcut ? t.clear : t.set}
                  aria-label={`${shortcut ? t.clear : t.set}：${template.name}`}
                  onClick={() => {
                    if (!shortcut) { start(template); return; }
                    cancel(); const saved = setDrawingTemplateBinding(type, template.id, null); setStatus(saved ? t.cleared : t.storageUnavailable);
                  }}>
                  {shortcut ? <Minus className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                </Button>
                <Button type="button" variant="ghost" className="h-auto min-h-10 max-w-[45%] shrink-0 px-1 font-normal" onClick={() => start(template)}
                  aria-label={`${t.change}：${template.name}`} aria-describedby={active && error ? errorId : undefined}>
                  <span aria-live="polite" className="min-w-0 whitespace-normal break-all rounded-md bg-slate-100 dark:bg-hover px-2 py-1 text-xs text-slate-600 dark:text-secondary-text">
                    {active ? t.recording : shortcut ? formatDrawingTemplateShortcut(shortcut, platform) : t.unset}
                  </span>
                </Button>
              </div>
              {active && error ? <p id={errorId} role="alert" className="px-3 pb-2 text-xs text-red-600 dark:text-negative">{error}</p> : null}
            </div>;
          }) : <p className="p-3 text-sm text-slate-500 dark:text-muted-foreground">{copy.marketReplay.noDrawingTemplates}</p>}
        </div>
        <p className="border-t px-3 py-2 text-xs text-slate-500 dark:text-muted-foreground">{t.hint}</p>
        {status ? <p role="status" aria-live="polite" className="px-3 pb-2 text-xs text-slate-600 dark:text-secondary-text">{status}</p> : null}
      </OptionPopoverContent>
    </Popover.Portal>
  </Popover.Root>;
}
