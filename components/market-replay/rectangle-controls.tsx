"use client";

import { useId, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LINE_STYLE_OPTIONS, StyleChoiceField, StyleColorField, StyleLineWidthField, StyleOpacityField, StyleTemplateField } from "@/components/ui/style-controls";
import { rectangleStyleSchema,
  type RectangleDrawing, type RectangleStyle, type RectangleTemplate } from "@/lib/market-replay/chart-drawings";
import { copy } from "@/lib/i18n";
import { createUuid } from "@/lib/uuid";

export function RectangleToolOption({ shortcut, onArm }: {
  shortcut: string; onArm: () => void;
}) {
  return <Button type="button" variant="ghost" className="w-full justify-start gap-3" aria-keyshortcuts="Shift+R" onClick={onArm}>
    <Square className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.marketReplay.rectangle}
    <kbd className="ml-auto whitespace-nowrap font-mono text-xs text-slate-500">{shortcut}</kbd>
  </Button>;
}

export function RectangleSettingsDialog({ drawing, templates, onTemplatesChange, onSave, onClose }: {
  drawing: RectangleDrawing; templates: RectangleTemplate[]; onTemplatesChange: (templates: RectangleTemplate[]) => void;
  onSave: (style: RectangleStyle) => Promise<boolean>; onClose: () => void;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState<RectangleStyle>(() => ({ ...drawing.style }));
  const [templateId, setTemplateId] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ template: RectangleTemplate; style: RectangleStyle } | null>(null);
  const valid = rectangleStyleSchema.safeParse(draft).success;
  const finishTemplateSave = (template: RectangleTemplate) => {
    onTemplatesChange(templates.some(item => item.id === template.id)
      ? templates.map(item => item.id === template.id ? template : item)
      : [...templates, template]);
    setTemplateId(template.id); setName(""); setTemplateDialogOpen(false); setConfirmation(null);
    setError(null); setTemplateError(null); setStatus(copy.marketReplay.rectangleTemplateSaved);
  };
  const saveTemplate = () => {
    const trimmed = name.trim();
    if (!valid || !trimmed || trimmed.length > 50) return;
    setStatus(""); setTemplateError(null);
    const existing = templates.find(t => t.name.toLocaleLowerCase("zh-CN") === trimmed.toLocaleLowerCase("zh-CN"));
    if (existing) { setConfirmation({ template: existing, style: { ...draft } }); return; }
    if (templates.length >= 50) { setTemplateError(copy.marketReplay.drawingTemplateLimit); return; }
    finishTemplateSave({ id: createUuid(), name: trimmed, style: { ...draft } });
  };
  return <>
    <Dialog open={!templateDialogOpen} title={copy.marketReplay.rectangleSettings} description={copy.marketReplay.rectangleSettingsDescription}
      className="max-w-md" onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-5" aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <StyleTemplateField value={templateId} templates={templates} onChange={value => {
              const template = templates.find(t => t.id === value);
              if (template) {
                setTemplateId(value); setDraft({ ...template.style });
                setError(null); setStatus("");
              }
            }} onDelete={() => {
              onTemplatesChange(templates.filter(template => template.id !== templateId));
              setTemplateId(""); setStatus(""); setError(null);
            }} />
          <StyleColorField label={copy.marketReplay.rectangleFillColor} value={draft.fillColor} onChange={fillColor => setDraft(s => ({ ...s, fillColor }))} />
          <StyleOpacityField label={copy.marketReplay.rectangleFillOpacity} value={draft.fillOpacity}
            invalid={!valid} describedBy={!valid ? `${prefix}-error` : undefined} onChange={fillOpacity => setDraft(s => ({ ...s, fillOpacity }))} />
          <StyleChoiceField label={copy.marketReplay.rectangleBorder} value={draft.borderStyle}
            options={[{ value: "NONE", label: copy.marketReplay.rectangleNoBorder }, ...LINE_STYLE_OPTIONS]}
            onChange={borderStyle => setDraft(s => ({ ...s, borderStyle }))} />
          {draft.borderStyle !== "NONE" ? <>
            <StyleColorField label={copy.marketReplay.rectangleBorderColor} value={draft.borderColor} onChange={borderColor => setDraft(s => ({ ...s, borderColor }))} />
            <StyleLineWidthField label={copy.marketReplay.rectangleBorderWidth} value={draft.borderWidth} onChange={borderWidth => setDraft(s => ({ ...s, borderWidth }))} />
          </> : null}
        </fieldset>
        {error || !valid ? <p id={`${prefix}-error`} role="alert" className="text-sm text-red-600">{error || copy.marketReplay.rectangleInvisible}</p> : null}
        {status ? <p role="status" className="text-sm text-emerald-700">{status}</p> : null}
        <p className="text-xs text-slate-500">{copy.marketReplay.rectangleTemplateHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy || !valid} onClick={() => {
            setName(""); setTemplateError(null); setTemplateDialogOpen(true);
          }}>{copy.marketReplay.saveDrawingTemplate}</Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.marketReplay.drawingCancel}</Button>
            <Button type="button" disabled={busy || !valid} onClick={async () => {
              setBusy(true); setError(null);
              try { if (await onSave({ ...draft })) onClose(); else setError(copy.marketReplay.drawingSaveError); }
              catch { setError(copy.marketReplay.drawingSaveError); }
              finally { setBusy(false); }
            }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{copy.marketReplay.drawingConfirm}</Button>
          </div>
        </div>
      </div>
    </Dialog>
    <Dialog open={templateDialogOpen} title={copy.marketReplay.saveDrawingTemplateTitle} className="max-w-md"
      onClose={() => { if (!confirmation) { setTemplateDialogOpen(false); setName(""); setTemplateError(null); } }}>
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); if (!confirmation) saveTemplate(); }}>
        <fieldset disabled={Boolean(confirmation)} className="space-y-2">
          <Label htmlFor={`${prefix}-name`}>{copy.marketReplay.drawingTemplateName}</Label>
          <Input id={`${prefix}-name`} value={name} maxLength={50} autoFocus placeholder={copy.marketReplay.rectangleTemplatePlaceholder}
            aria-invalid={Boolean(templateError)} aria-describedby={templateError ? `${prefix}-template-error` : undefined}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
        </fieldset>
        {templateError ? <p id={`${prefix}-template-error`} role="alert" className="text-sm text-red-600">{templateError}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={Boolean(confirmation)} onClick={() => { setTemplateDialogOpen(false); setName(""); setTemplateError(null); }}>{copy.marketReplay.drawingCancel}</Button>
          <Button type="submit" disabled={!name.trim() || name.trim().length > 50 || !valid || Boolean(confirmation)}>{copy.marketReplay.saveDrawingTemplate}</Button>
        </div>
      </form>
    </Dialog>
    <ConfirmDialog open={Boolean(confirmation)} layerClassName="z-[80]"
      title={copy.marketReplay.rectangleTemplateOverwrite}
      description={copy.marketReplay.rectangleTemplateOverwriteDescription(confirmation?.template.name ?? "")}
      onCancel={() => setConfirmation(null)} onConfirm={() => {
        if (confirmation) finishTemplateSave({ ...confirmation.template, style: { ...confirmation.style } });
      }} />
  </>;
}
