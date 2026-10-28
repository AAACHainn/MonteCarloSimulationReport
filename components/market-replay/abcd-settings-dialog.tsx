"use client";

import { useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LINE_STYLE_OPTIONS, StyleChoiceField, StyleColorField, StyleLineWidthField, StyleTemplateField } from "@/components/ui/style-controls";
import { abcdSettingsStyle } from "@/lib/market-replay/abcd-style";
import { DRAWING_TYPE_ABCD, drawingStyleMatchesType, type AbcdDrawing } from "@/lib/market-replay/chart-drawings";
import { copy } from "@/lib/i18n";
import { createUuid } from "@/lib/uuid";

type AbcdStyle = AbcdDrawing["style"];
type AbcdTemplate = { id: string; name: string; style: AbcdStyle };

export function AbcdSettingsDialog({ draft, onDraftChange, templates, onTemplatesChange, onSave, onClose }: {
  draft: AbcdStyle;
  onDraftChange: (style: AbcdStyle) => void;
  templates: AbcdTemplate[];
  onTemplatesChange: (templates: AbcdTemplate[]) => void;
  onSave: (style: AbcdStyle) => Promise<boolean>;
  onClose: () => void;
}) {
  const prefix = useId();
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const style = abcdSettingsStyle(draft);
  const valid = drawingStyleMatchesType(DRAWING_TYPE_ABCD, style);
  const change = (next: AbcdStyle) => { setSaveError(null); onDraftChange(abcdSettingsStyle(next)); };
  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name || name.length > 50 || !valid) return;
    const existing = templates.find(item => item.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"));
    if (!existing && templates.length >= 50) { setTemplateError(copy.marketReplay.drawingTemplateLimit); return; }
    const template = { id: existing?.id ?? createUuid(), name, style: abcdSettingsStyle(style) };
    onTemplatesChange(existing ? templates.map(item => item.id === existing.id ? template : item) : [...templates, template]);
    setSelectedTemplateId(template.id); setTemplateDialogOpen(false); setTemplateName(""); setTemplateError(null);
  };
  return <>
    <Dialog open={!templateDialogOpen} title={copy.marketReplay.abcdSettings} description={copy.marketReplay.abcdSettingsDescription}
      className="max-w-md" onClose={() => { if (!saving.current) onClose(); }}>
      <div className="space-y-5" aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <StyleTemplateField value={selectedTemplateId} templates={templates} onChange={id => {
            const template = templates.find(item => item.id === id);
            if (!template) return;
            setSelectedTemplateId(id); change(template.style);
          }} onDelete={() => {
            onTemplatesChange(templates.filter(item => item.id !== selectedTemplateId)); setSelectedTemplateId("");
          }} />
          <StyleColorField label={copy.marketReplay.lineColor} value={style.singleColor!}
            onChange={singleColor => change({ ...style, singleColor })} />
          <StyleLineWidthField label={copy.marketReplay.lineWidth} value={style.width}
            onChange={width => change({ ...style, width })} />
          <StyleChoiceField label={copy.marketReplay.lineStyle} value={style.lineStyle} options={LINE_STYLE_OPTIONS}
            onChange={lineStyle => change({ ...style, lineStyle })} />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={style.showPrices} onChange={event => change({ ...style, showPrices: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 focus-visible:ring-2 focus-visible:ring-ring" />
              {copy.marketReplay.abcdShowPrices}
            </label>
            <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={style.showLevels} onChange={event => change({ ...style, showLevels: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 focus-visible:ring-2 focus-visible:ring-ring" />
              {copy.marketReplay.abcdShowLabels}
            </label>
          </div>
        </fieldset>
        {saveError || !valid ? <p role="alert" className="text-sm text-red-600">{saveError || copy.marketReplay.invalidDrawing}</p> : null}
        <p className="text-xs text-slate-500">{copy.marketReplay.abcdNextStyleHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy || !valid} onClick={() => {
            setTemplateName(""); setTemplateError(null); setTemplateDialogOpen(true);
          }}>{copy.marketReplay.saveDrawingTemplate}</Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.marketReplay.drawingCancel}</Button>
            <Button type="button" disabled={busy || !valid} onClick={async () => {
              if (saving.current || !valid) return;
              saving.current = true; setBusy(true); setSaveError(null);
              try { if (await onSave(abcdSettingsStyle(style))) onClose(); else setSaveError(copy.marketReplay.drawingSaveError); }
              catch { setSaveError(copy.marketReplay.drawingSaveError); }
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
