"use client";

import { useId, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_FIBONACCI_RETRACEMENT_STYLE, rectangleStyleSchema,
  type RectangleDrawing, type RectangleStyle, type RectangleTemplate } from "@/lib/market-replay/chart-drawings";
import { copy } from "@/lib/i18n";
import { createUuid } from "@/lib/uuid";

export function RectangleToolOption({ shortcut, templates, onArm, onTemplate }: {
  shortcut: string; templates: RectangleTemplate[]; onArm: () => void; onTemplate: (style: RectangleStyle) => void;
}) {
  const id = useId();
  return <div>
    <Button type="button" variant="ghost" className="w-full justify-start gap-3" aria-keyshortcuts="Alt+r" onClick={onArm}>
      <Square className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.marketReplay.rectangle}
      <kbd className="ml-auto whitespace-nowrap font-mono text-xs text-slate-500">{shortcut}</kbd>
    </Button>
    <div className="px-3 pb-2 pt-1">
      <Label htmlFor={id} className="sr-only">{copy.marketReplay.rectanglePreset}</Label>
      <Select value="__default" disabled={!templates.length} onValueChange={value => {
        const template = templates.find(t => t.id === value);
        if (template) { onTemplate({ ...template.style }); onArm(); }
      }}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__default" disabled>{templates.length ? copy.marketReplay.rectanglePresetDefault : copy.marketReplay.noDrawingTemplates}</SelectItem>
          {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  </div>;
}

function RectangleColorField({ label, value, disabled, onChange }: {
  label: string; value: string; disabled?: boolean; onChange: (color: string) => void;
}) {
  const id = useId();
  const colors = [...new Set(DEFAULT_FIBONACCI_RETRACEMENT_STYLE.levels.map(l => l.color))].slice(0, 6);
  return <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex flex-wrap items-center gap-2">
      <Input id={id} type="color" value={value} disabled={disabled} onChange={e => onChange(e.target.value.toUpperCase())} className="w-14 cursor-pointer p-1" />
      {colors.map(color => <Button key={color} type="button" variant="outline" size="icon" disabled={disabled}
        aria-label={copy.marketReplay.rectanglePresetColor(color)} aria-pressed={color.toLowerCase() === value.toLowerCase()}
        onClick={() => onChange(color)}><span className="h-4 w-4 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" /></Button>)}
    </div>
  </div>;
}

export function RectangleSettingsDialog({ drawing, templates, onTemplatesChange, onSave, onClose }: {
  drawing: RectangleDrawing; templates: RectangleTemplate[]; onTemplatesChange: (templates: RectangleTemplate[]) => void;
  onSave: (style: RectangleStyle) => Promise<boolean>; onClose: () => void;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState<RectangleStyle>(() => ({ ...drawing.style }));
  const [opacityInput, setOpacityInput] = useState(String(drawing.style.fillOpacity));
  const [widthInput, setWidthInput] = useState(String(drawing.style.borderWidth));
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ kind: "overwrite" | "delete"; template: RectangleTemplate; style?: RectangleStyle } | null>(null);
  const valid = rectangleStyleSchema.safeParse(draft).success;
  const saveTemplate = () => {
    setStatus("");
    if (!valid) { setError(copy.marketReplay.rectangleInvisible); return; }
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = templates.find(t => t.name.toLocaleLowerCase("zh-CN") === trimmed.toLocaleLowerCase("zh-CN"));
    if (existing) { setConfirmation({ kind: "overwrite", template: existing, style: { ...draft } }); return; }
    if (templates.length >= 50) { setError(copy.marketReplay.drawingTemplateLimit); return; }
    const template = { id: createUuid(), name: trimmed, style: { ...draft } };
    onTemplatesChange([...templates, template]); setTemplateId(template.id); setName("");
    setError(null); setStatus(copy.marketReplay.rectangleTemplateSaved);
  };
  return <>
    <Dialog open title={copy.marketReplay.rectangleSettings} description={copy.marketReplay.rectangleSettingsDescription}
      className="max-w-xl" onClose={() => { if (!busy && !confirmation) onClose(); }}>
      <div className="space-y-5" aria-busy={busy}>
        <fieldset disabled={busy || Boolean(confirmation)} className="min-w-0 space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-template`}>{copy.marketReplay.drawingTemplate}</Label>
            <Select value={templateId || "__none"} onValueChange={value => {
              const template = templates.find(t => t.id === value);
              if (template) {
                setTemplateId(value); setDraft({ ...template.style });
                setOpacityInput(String(template.style.fillOpacity)); setWidthInput(String(template.style.borderWidth));
                setError(null); setStatus("");
              }
            }}>
              <SelectTrigger id={`${prefix}-template`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none" disabled>{templates.length ? copy.marketReplay.chooseDrawingTemplate : copy.marketReplay.noDrawingTemplates}</SelectItem>
                {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {templateId ? <Button type="button" variant="outline" onClick={() => {
              const template = templates.find(t => t.id === templateId);
              if (template) setConfirmation({ kind: "delete", template });
            }}>{copy.marketReplay.deleteDrawingTemplate}</Button> : null}
          </div>
          <RectangleColorField label={copy.marketReplay.rectangleFillColor} value={draft.fillColor} onChange={fillColor => setDraft(s => ({ ...s, fillColor }))} />
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-opacity`}>{copy.marketReplay.rectangleFillOpacity}</Label>
            <Input id={`${prefix}-opacity`} type="number" min={0} max={100} step={1} value={opacityInput}
              aria-invalid={!valid} aria-describedby={`${prefix}-error`} onChange={e => {
                setOpacityInput(e.target.value); setDraft(s => ({ ...s, fillOpacity: e.target.valueAsNumber }));
              }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-border`}>{copy.marketReplay.rectangleBorder}</Label>
            <Select value={draft.borderStyle} onValueChange={value => setDraft(s => ({ ...s, borderStyle: value as RectangleStyle["borderStyle"] }))}>
              <SelectTrigger id={`${prefix}-border`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{copy.marketReplay.rectangleNoBorder}</SelectItem>
                <SelectItem value="SOLID">{copy.marketReplay.lineSolid}</SelectItem>
                <SelectItem value="DASHED">{copy.marketReplay.lineDashed}</SelectItem>
                <SelectItem value="DOTTED">{copy.marketReplay.lineDotted}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.borderStyle !== "NONE" ? <>
            <RectangleColorField label={copy.marketReplay.rectangleBorderColor} value={draft.borderColor} onChange={borderColor => setDraft(s => ({ ...s, borderColor }))} />
            <div className="space-y-2"><Label htmlFor={`${prefix}-width`}>{copy.marketReplay.rectangleBorderWidth}</Label>
              <Input id={`${prefix}-width`} type="number" min={1} max={4} step={1} value={widthInput} aria-invalid={!valid}
                aria-describedby={`${prefix}-error`} onChange={e => { setWidthInput(e.target.value); setDraft(s => ({ ...s, borderWidth: e.target.valueAsNumber })); }} />
            </div>
          </> : null}
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor={`${prefix}-name`}>{copy.marketReplay.drawingTemplateName}</Label>
            <Input id={`${prefix}-name`} value={name} maxLength={50} placeholder={copy.marketReplay.rectangleTemplatePlaceholder}
              onChange={e => setName(e.target.value)} />
            <Button type="button" variant="outline" disabled={!name.trim() || !valid} onClick={saveTemplate}>{copy.marketReplay.saveDrawingTemplate}</Button>
          </div>
        </fieldset>
        <p className="text-xs text-slate-500">{copy.marketReplay.rectangleTemplateHint}</p>
        <p id={`${prefix}-error`} role={error || !valid ? "alert" : undefined} className="text-sm text-red-600">{error || (!valid ? copy.marketReplay.rectangleInvisible : "")}</p>
        {status ? <p role="status" className="text-sm text-emerald-700">{status}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.marketReplay.drawingCancel}</Button>
          <Button type="button" disabled={busy || !valid} onClick={async () => {
            setBusy(true); setError(null);
            try { if (await onSave({ ...draft })) onClose(); else setError(copy.marketReplay.drawingSaveError); }
            catch { setError(copy.marketReplay.drawingSaveError); }
            finally { setBusy(false); }
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{copy.marketReplay.drawingConfirm}</Button>
        </div>
      </div>
    </Dialog>
    <ConfirmDialog open={Boolean(confirmation)} layerClassName="z-[80]"
      title={confirmation?.kind === "overwrite" ? copy.marketReplay.rectangleTemplateOverwrite : copy.marketReplay.deleteDrawingTemplate}
      description={confirmation?.kind === "overwrite" ? copy.marketReplay.rectangleTemplateOverwriteDescription(confirmation.template.name)
        : copy.marketReplay.rectangleTemplateDeleteDescription(confirmation?.template.name ?? "")}
      onCancel={() => setConfirmation(null)} onConfirm={() => {
        if (!confirmation) return;
        if (confirmation.kind === "delete") {
          onTemplatesChange(templates.filter(t => t.id !== confirmation.template.id)); setTemplateId("");
        } else {
          onTemplatesChange(templates.map(t => t.id === confirmation.template.id ? { ...t, style: { ...confirmation.style! } } : t));
          setTemplateId(confirmation.template.id); setName(""); setStatus(copy.marketReplay.rectangleTemplateSaved);
        }
        setError(null); setConfirmation(null);
      }} />
  </>;
}
