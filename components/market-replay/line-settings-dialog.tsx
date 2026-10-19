"use client";

import { useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LINE_STYLE_OPTIONS, StyleChoiceField, StyleColorField, StyleLineWidthField, StyleOpacityField, StyleTemplateField } from "@/components/ui/style-controls";
import { DRAWING_TYPE_FIB_RETRACEMENT, drawingStyleMatchesType, hasDuplicateEnabledFibonacciLevels,
  type TrendLineDrawing, type FibonacciRetracementDrawing, type TrendLineStyle, type FibonacciRetracementStyle,
  type TrendLineTemplate, type FibonacciRetracementTemplate } from "@/lib/market-replay/chart-drawings";
import { copy } from "@/lib/i18n";
import { createUuid } from "@/lib/uuid";

export type LineDrawingStyle = TrendLineStyle | FibonacciRetracementStyle;
type LineTemplate = TrendLineTemplate | FibonacciRetracementTemplate;
export function cloneLineDrawingStyle(style: LineDrawingStyle): LineDrawingStyle {
  return "levels" in style ? { ...style, levels: style.levels.map(level => ({ ...level })) } : { ...style };
}

export function LineSettingsDialog({ drawing, draft: styleDraft, onDraftChange: setStyleDraft, templates,
  onTemplatesChange, onSave, onClose }: {
  drawing: TrendLineDrawing | FibonacciRetracementDrawing;
  draft: LineDrawingStyle;
  onDraftChange: Dispatch<SetStateAction<LineDrawingStyle | null>>;
  templates: LineTemplate[];
  onTemplatesChange: (templates: LineTemplate[]) => void;
  onSave: (style: LineDrawingStyle) => Promise<boolean>;
  onClose: () => void;
}) {
  const prefix = useId();
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [styleDraftError, setStyleDraftError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const isFibonacci = drawing.type === DRAWING_TYPE_FIB_RETRACEMENT;
  const valid = drawingStyleMatchesType(drawing.type, styleDraft);
  const validationError = isFibonacci && "levels" in styleDraft && hasDuplicateEnabledFibonacciLevels(styleDraft)
    ? copy.marketReplay.fibonacciDuplicateEnabledLevels : copy.marketReplay.invalidDrawing;
  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name || name.length > 50 || !valid) return;
    const existing = templates.find(template => template.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"));
    if (!existing && templates.length >= 50) { setTemplateError(copy.marketReplay.drawingTemplateLimit); return; }
    const template = { id: existing?.id ?? createUuid(), name, style: cloneLineDrawingStyle(styleDraft) } as LineTemplate;
    onTemplatesChange(existing ? templates.map(item => item.id === existing.id ? template : item) : [...templates, template]);
    setSelectedTemplateId(template.id); setTemplateDialogOpen(false); setTemplateName(""); setTemplateError(null);
  };
  return <>
    <Dialog open={!templateDialogOpen} title={isFibonacci ? copy.marketReplay.fibonacciSettings : copy.marketReplay.trendLineSettings}
      description={isFibonacci ? copy.marketReplay.fibonacciSettingsDescription : copy.marketReplay.trendLineSettingsDescription}
      className={isFibonacci ? "max-w-2xl" : "max-w-md"} onClose={() => { if (!saving.current) onClose(); }}>
      <div className="space-y-5" aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <StyleTemplateField value={selectedTemplateId} templates={templates}
                onChange={(value) => {
                  if (value === "__none") return;
                  const template = templates.find((item) => item.id === value);
                  if (!template) return;
                  setSelectedTemplateId(value);
                  setStyleDraftError(null);
                  setStyleDraft(isFibonacci
                    ? cloneLineDrawingStyle(template.style)
                    : { ...template.style as TrendLineStyle });
                }} onDelete={() => { onTemplatesChange(templates.filter(template => template.id !== selectedTemplateId)); setSelectedTemplateId(""); }} />
          {!isFibonacci && "color" in styleDraft ? <StyleColorField label={copy.marketReplay.lineColor} value={styleDraft.color}
            onChange={color => setStyleDraft(current => current && "color" in current ? { ...current, color } : current)} /> : null}
          {!isFibonacci && "opacity" in styleDraft ? <StyleOpacityField label={copy.marketReplay.lineOpacity} value={styleDraft.opacity}
            onChange={opacity => setStyleDraft(current => current && "opacity" in current ? { ...current, opacity } : current)} /> : null}
          {isFibonacci ? <p className="text-sm font-medium text-slate-800">{copy.marketReplay.horizontalLineStyle}</p> : null}
          <StyleLineWidthField label={copy.marketReplay.lineWidth} value={styleDraft.width}
            onChange={width => setStyleDraft(current => current ? { ...current, width } : current)} />
          <StyleChoiceField label={copy.marketReplay.lineStyle} value={styleDraft.lineStyle} options={LINE_STYLE_OPTIONS}
            onChange={lineStyle => setStyleDraft(current => current ? { ...current, lineStyle } : current)} />
          {!isFibonacci && "showStartPrice" in styleDraft ? <div className="space-y-2 rounded-md border bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={styleDraft.showStartPrice}
                onChange={(event) => setStyleDraft((current) => current && "showStartPrice" in current ? { ...current, showStartPrice: event.target.checked } : current)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {copy.marketReplay.showStartPrice}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={styleDraft.showEndPrice}
                onChange={(event) => setStyleDraft((current) => current && "showEndPrice" in current ? { ...current, showEndPrice: event.target.checked } : current)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {copy.marketReplay.showEndPrice}
            </label>
          </div> : null}
          {isFibonacci && "levels" in styleDraft ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-800">{copy.marketReplay.fibonacciLevels}</p>
              <div className="grid grid-cols-1 gap-2 rounded-md border bg-slate-50 p-3 sm:grid-cols-2">
                {styleDraft.levels.map((level, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={level.enabled}
                      aria-label={copy.marketReplay.fibonacciLevelToggle(level.value)}
                      onChange={(event) => {
                        setStyleDraftError(null);
                        setStyleDraft((current) => current && "levels" in current ? {
                          ...current,
                          levels: current.levels.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item),
                        } : current);
                      }}
                      className="h-4 w-4 shrink-0 rounded border-slate-300"
                    />
                    <Input
                      type="number"
                      min="-10"
                      max="10"
                      step="0.001"
                      value={level.value}
                      aria-label={copy.marketReplay.fibonacciLevelValue(index + 1)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value) || value < -10 || value > 10) return;
                        setStyleDraftError(null);
                        setStyleDraft((current) => current && "levels" in current ? {
                          ...current,
                          levels: current.levels.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item),
                        } : current);
                      }}
                      className="h-9 min-w-0 flex-1 font-mono text-xs"
                    />
                    <Input
                      type="color"
                      value={level.color}
                      aria-label={copy.marketReplay.fibonacciLevelColor(level.value)}
                      onChange={(event) => setStyleDraft((current) => current && "levels" in current ? {
                        ...current,
                        levels: current.levels.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value.toUpperCase() } : item),
                      } : current)}
                      className="h-9 w-11 shrink-0 cursor-pointer p-1"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </fieldset>
        {styleDraftError || !valid ? <p role="alert" className="text-sm text-red-600">{styleDraftError || validationError}</p> : null}
        <p className="text-xs text-slate-500">{isFibonacci ? copy.marketReplay.nextFibonacciStyleHint : copy.marketReplay.nextTrendLineStyleHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy || !valid} onClick={() => {
            setTemplateName(""); setTemplateError(null); setTemplateDialogOpen(true);
          }}>{copy.marketReplay.saveDrawingTemplate}</Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.marketReplay.drawingCancel}</Button>
            <Button type="button" disabled={busy || !valid} onClick={async () => {
              if (saving.current || !valid) return;
              saving.current = true; setBusy(true); setStyleDraftError(null);
              try { if (await onSave(cloneLineDrawingStyle(styleDraft))) onClose(); else setStyleDraftError(copy.marketReplay.drawingSaveError); }
              catch { setStyleDraftError(copy.marketReplay.drawingSaveError); }
              finally { saving.current = false; setBusy(false); }
            }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{copy.marketReplay.drawingConfirm}</Button>
          </div>
        </div>
      </div>
    </Dialog>
    <Dialog open={templateDialogOpen} title={copy.marketReplay.saveDrawingTemplateTitle} className="max-w-md"
      onClose={() => { setTemplateDialogOpen(false); setTemplateName(""); setTemplateError(null); }}>
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); saveTemplate(); }}>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-name`}>{copy.marketReplay.drawingTemplateName}</Label>
          <Input id={`${prefix}-name`} value={templateName} maxLength={50} autoFocus placeholder={copy.marketReplay.drawingTemplateNamePlaceholder}
            aria-invalid={Boolean(templateError)} aria-describedby={templateError ? `${prefix}-template-error` : undefined}
            onChange={event => setTemplateName(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
        </div>
        {templateError ? <p id={`${prefix}-template-error`} role="alert" className="text-sm text-red-600">{templateError}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => { setTemplateDialogOpen(false); setTemplateError(null); }}>{copy.marketReplay.drawingCancel}</Button>
          <Button type="submit" disabled={!templateName.trim() || !valid}>{copy.marketReplay.saveDrawingTemplate}</Button>
        </div>
      </form>
    </Dialog>
  </>;
}
