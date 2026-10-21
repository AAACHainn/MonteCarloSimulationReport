"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Bold, Italic, Loader2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StyleColorField, StyleOpacityField, StyleTemplateField } from "@/components/ui/style-controls";
import { TEXT_FONT_SIZES, normalizeDrawingText, textGeometrySchema, textDrawingStyleSchema,
  type TextGeometry, type TextDrawingStyle, type TextTemplate } from "@/lib/market-replay/chart-drawings";
import type { TextDrawingApi, TextEditPreview } from "@/lib/market-replay/text-drawing-primitive";
import { TextInlineEditor } from "./text-inline-editor";
import { createUuid } from "@/lib/uuid";
import { copy } from "@/lib/i18n";

export type TextEditor = TextEditPreview & { key: string };
export function TextToolOption({ onArm }: { onArm: () => void }) {
  return <Button type="button" variant="ghost" className="w-full justify-start gap-3" aria-keyshortcuts="Shift+t" onClick={onArm}>
    <Type className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.marketReplay.textTool}
    <kbd className="ml-auto whitespace-nowrap font-mono text-xs text-slate-500">{copy.marketReplay.textShortcut}</kbd>
  </Button>;
}
function TextToggle({ label, checked, onChange, children }: { label: string; checked: boolean;
  onChange: (checked: boolean) => void; children?: ReactNode }) {
  return <div className="space-y-3">
    <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 focus-visible:ring-2 focus-visible:ring-ring" />{label}
    </label>
    {checked ? children : null}
  </div>;
}
export function TextSettingsDialog({ editor, apiRef, templates, onTemplatesChange, onPreview, onSave, onClose }: {
  editor: TextEditor; templates: TextTemplate[]; onTemplatesChange: (templates: TextTemplate[]) => void;
  apiRef: RefObject<TextDrawingApi | null>;
  onPreview: (preview: TextEditPreview | null) => void;
  onSave: (geometry: TextGeometry, style: TextDrawingStyle) => Promise<boolean>; onClose: () => void;
}) {
  const prefix = useId();
  const [text, setText] = useState(editor.geometry.text);
  const [style, setStyle] = useState(() => ({ ...editor.style }));
  const [width, setWidth] = useState(String(editor.style.wrapWidth));
  const [templateId, setTemplateId] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!editor.inline);
  const saving = useRef(false);
  const normalized = normalizeDrawingText(text);
  const geometry = { anchor: editor.geometry.anchor, text: normalized };
  const contentValid = textGeometrySchema.safeParse(geometry).success;
  const widthValid = !style.wrapEnabled || /^\d+$/.test(width) && Number(width) >= 120 && Number(width) <= 800;
  const styleValid = textDrawingStyleSchema.safeParse(style).success && widthValid;
  const inline = Boolean(editor.inline && !settingsOpen && !naming);
  useEffect(() => { onPreview({ id: editor.id, geometry: { anchor: editor.geometry.anchor, text: contentValid ? normalized : "" }, style, inline }); },
    [editor.id, editor.geometry.anchor, normalized, contentValid, style, inline, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);
  const save = async () => {
    if (saving.current) return;
    if (!contentValid || !styleValid) { setError(!contentValid ? copy.marketReplay.textContentError : copy.marketReplay.textWrapError); return; }
    saving.current = true; setBusy(true); setError(null);
    try { if (await onSave(geometry, { ...style })) onClose(); else setError(copy.marketReplay.drawingSaveError); }
    catch { setError(copy.marketReplay.drawingSaveError); }
    finally { saving.current = false; setBusy(false); }
  };
  const saveTemplate = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 50 || !styleValid) return;
    const existing = templates.find(item => item.name.toLocaleLowerCase("zh-CN") === trimmed.toLocaleLowerCase("zh-CN"));
    if (!existing && templates.length >= 50) { setTemplateError(copy.marketReplay.drawingTemplateLimit); return; }
    const template = { id: existing?.id ?? createUuid(), name: trimmed, style: { ...style } };
    onTemplatesChange(existing ? templates.map(item => item.id === existing.id ? template : item) : [...templates, template]);
    setTemplateId(template.id); setNaming(false); setName(""); setTemplateError(null);
  };
  return <>
    {inline ? <TextInlineEditor apiRef={apiRef} anchor={editor.geometry.anchor} text={text} style={style}
      onChange={value => { setText(value); setError(null); }} valid={contentValid && styleValid} busy={busy} error={error}
      onSave={save} onClose={onClose} onSettings={() => setSettingsOpen(true)} /> : null}
    <Dialog open={settingsOpen && !naming} title={copy.marketReplay.textSettings} description={copy.marketReplay.textSettingsDescription}
      className="max-w-md" onClose={() => { if (!saving.current) onClose(); }}>
      <div className="space-y-5" aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <StyleTemplateField value={templateId} templates={templates} onChange={id => {
            const template = templates.find(item => item.id === id);
            if (template) { setTemplateId(id); setStyle({ ...template.style }); setWidth(String(template.style.wrapWidth)); setError(null); }
          }} onDelete={() => { onTemplatesChange(templates.filter(item => item.id !== templateId)); setTemplateId(""); }} />
          <StyleColorField label={copy.marketReplay.textColor} value={style.color} onChange={color => setStyle(s => ({ ...s, color }))} />
          <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-3">
            <Label htmlFor={`${prefix}-size`}>{copy.marketReplay.textFontSize}</Label>
            <Select value={String(style.fontSize)} onValueChange={value => setStyle(s => ({ ...s, fontSize: Number(value) as TextDrawingStyle["fontSize"] }))}>
              <SelectTrigger id={`${prefix}-size`}><SelectValue /></SelectTrigger>
              <SelectContent>{TEXT_FONT_SIZES.map(size => <SelectItem key={size} value={String(size)}>{size} px</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-3">
            <Label id={`${prefix}-font`}>{copy.marketReplay.textFontStyle}</Label>
            <div role="group" aria-labelledby={`${prefix}-font`} className="flex gap-2">
              {[{ key: "bold" as const, label: copy.marketReplay.textBold, Icon: Bold }, { key: "italic" as const, label: copy.marketReplay.textItalic, Icon: Italic }].map(({ key, label, Icon }) =>
                <Button key={key} type="button" variant="outline" aria-label={label} aria-pressed={style[key]}
                  className={style[key] ? "border-blue-600 bg-blue-50 text-blue-700" : ""}
                  onClick={() => setStyle(s => ({ ...s, [key]: !s[key] }))}><Icon className="h-4 w-4" aria-hidden="true" />{label}</Button>)}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-text`}>{copy.marketReplay.textContent}</Label>
            <Textarea id={`${prefix}-text`} data-dialog-initial-focus autoFocus value={text} onChange={event => { setText(event.target.value); setError(null); }}
              aria-invalid={Boolean(text) && !contentValid} aria-describedby={`${prefix}-content-hint`} className="min-h-32 resize-y" />
            <p id={`${prefix}-content-hint`} className={text && !contentValid ? "text-xs text-red-600" : "text-xs text-slate-500"}>
              {normalized.length} / 2000 · {text && !contentValid ? copy.marketReplay.textContentError : copy.marketReplay.textContentHint}
            </p>
          </div>
          <TextToggle label={copy.marketReplay.textBackground} checked={style.backgroundEnabled} onChange={backgroundEnabled => setStyle(s => ({ ...s, backgroundEnabled }))}>
            <StyleColorField label={copy.marketReplay.textBackgroundColor} value={style.backgroundColor} onChange={backgroundColor => setStyle(s => ({ ...s, backgroundColor }))} />
            <StyleOpacityField label={copy.marketReplay.textBackgroundOpacity} value={style.backgroundOpacity} onChange={backgroundOpacity => setStyle(s => ({ ...s, backgroundOpacity }))} />
          </TextToggle>
          <TextToggle label={copy.marketReplay.textBorder} checked={style.borderEnabled} onChange={borderEnabled => setStyle(s => ({ ...s, borderEnabled }))}>
            <StyleColorField label={copy.marketReplay.textBorderColor} value={style.borderColor} onChange={borderColor => setStyle(s => ({ ...s, borderColor }))} />
          </TextToggle>
          <TextToggle label={copy.marketReplay.textWrap} checked={style.wrapEnabled} onChange={wrapEnabled => setStyle(s => ({ ...s, wrapEnabled }))}>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-width`}>{copy.marketReplay.textWrapWidth}</Label>
              <Input id={`${prefix}-width`} type="number" min={120} max={800} step={1} value={width} aria-invalid={!widthValid}
                aria-describedby={`${prefix}-width-hint`} onChange={event => {
                  const value = event.target.value; setWidth(value);
                  if (/^\d+$/.test(value) && Number(value) >= 120 && Number(value) <= 800) setStyle(s => ({ ...s, wrapWidth: Number(value) }));
                }} />
              <p id={`${prefix}-width-hint`} className={widthValid ? "text-xs text-slate-500" : "text-xs text-red-600"}>{widthValid ? copy.marketReplay.textWrapHint : copy.marketReplay.textWrapError}</p>
            </div>
          </TextToggle>
        </fieldset>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        <p className="text-xs text-slate-500">{copy.marketReplay.textStyleHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy || !styleValid} onClick={() => { setName(""); setTemplateError(null); setNaming(true); }}>{copy.marketReplay.saveDrawingTemplate}</Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.marketReplay.drawingCancel}</Button>
            <Button type="button" disabled={busy || !contentValid || !styleValid} onClick={() => void save()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{copy.marketReplay.drawingConfirm}</Button>
          </div>
        </div>
      </div>
    </Dialog>
    <Dialog open={naming} title={copy.marketReplay.saveDrawingTemplateTitle} className="max-w-md" onClose={() => setNaming(false)}>
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); saveTemplate(); }}>
        <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>{copy.marketReplay.drawingTemplateName}</Label>
          <Input id={`${prefix}-name`} value={name} autoFocus maxLength={50} onChange={event => setName(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
        </div>
        {templateError ? <p role="alert" className="text-xs text-red-600">{templateError}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => setNaming(false)}>{copy.marketReplay.drawingCancel}</Button>
          <Button type="submit" disabled={!name.trim() || !styleValid}>{copy.marketReplay.saveDrawingTemplate}</Button>
        </div>
      </form>
    </Dialog>
  </>;
}
