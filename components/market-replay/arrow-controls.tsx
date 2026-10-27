"use client";

import { useId, useState } from "react";
import { ArrowBigDown, ArrowBigUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StyleColorField, StyleTemplateField } from "@/components/ui/style-controls";
import { arrowStyleSchema, type ArrowDrawing, type ArrowDrawingType, type ArrowStyle, type ArrowTemplate } from "@/lib/market-replay/chart-drawings";
import { copy } from "@/lib/i18n";
import { createUuid } from "@/lib/uuid";

export function ArrowToolOptions({ onArm }: { onArm: (type: ArrowDrawingType) => void }) {
  return <>
    <Button type="button" variant="ghost" className="w-full justify-start gap-3" onClick={() => onArm("ARROW_UP")}>
      <ArrowBigUp className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.marketReplay.arrowUp}
    </Button>
    <Button type="button" variant="ghost" className="w-full justify-start gap-3" onClick={() => onArm("ARROW_DOWN")}>
      <ArrowBigDown className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.marketReplay.arrowDown}
    </Button>
  </>;
}

export function ArrowSettingsDialog({ drawing, templates, onTemplatesChange, onSave, onClose }: {
  drawing: ArrowDrawing; templates: ArrowTemplate[]; onTemplatesChange: (templates: ArrowTemplate[]) => void;
  onSave: (style: ArrowStyle) => Promise<boolean>; onClose: () => void;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState<ArrowStyle>(() => ({ ...drawing.style }));
  const [templateId, setTemplateId] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ template: ArrowTemplate; style: ArrowStyle } | null>(null);
  const valid = arrowStyleSchema.safeParse(draft).success;
  const finishTemplateSave = (template: ArrowTemplate) => {
    onTemplatesChange(templates.some(item => item.id === template.id)
      ? templates.map(item => item.id === template.id ? template : item) : [...templates, template]);
    setTemplateId(template.id); setName(""); setTemplateDialogOpen(false); setConfirmation(null);
    setError(null); setTemplateError(null); setStatus(copy.marketReplay.arrowTemplateSaved);
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
    <Dialog open={!templateDialogOpen} title={drawing.type === "ARROW_UP" ? copy.marketReplay.arrowUpSettings : copy.marketReplay.arrowDownSettings}
      className="max-w-md" onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-5" aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <StyleTemplateField value={templateId} templates={templates} onChange={value => {
            const template = templates.find(t => t.id === value);
            if (template) { setTemplateId(value); setDraft({ ...template.style }); setError(null); setStatus(""); }
          }} onDelete={() => { onTemplatesChange(templates.filter(t => t.id !== templateId)); setTemplateId(""); setStatus(""); setError(null); }} />
          <StyleColorField label={copy.marketReplay.arrowColor} value={draft.color} onChange={color => setDraft({ color })} />
        </fieldset>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        {status ? <p role="status" className="text-sm text-emerald-700">{status}</p> : null}
        <p className="text-xs text-slate-500">{copy.marketReplay.arrowTemplateHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy || !valid} onClick={() => { setName(""); setTemplateError(null); setTemplateDialogOpen(true); }}>{copy.marketReplay.saveDrawingTemplate}</Button>
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
          <Input id={`${prefix}-name`} value={name} maxLength={50} autoFocus placeholder={copy.marketReplay.arrowTemplatePlaceholder}
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
    <ConfirmDialog open={Boolean(confirmation)} layerClassName="z-[80]" title={copy.marketReplay.arrowTemplateOverwrite}
      description={copy.marketReplay.arrowTemplateOverwriteDescription(confirmation?.template.name ?? "")}
      onCancel={() => setConfirmation(null)} onConfirm={() => { if (confirmation) finishTemplateSave({ ...confirmation.template, style: { ...confirmation.style } }); }} />
  </>;
}
