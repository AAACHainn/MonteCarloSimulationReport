"use client";

import { useId, type ReactNode } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPercent } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const LINE_STYLE_OPTIONS = [
  { value: "SOLID", label: copy.marketReplay.lineSolid },
  { value: "DASHED", label: copy.marketReplay.lineDashed },
  { value: "DOTTED", label: copy.marketReplay.lineDotted },
] as const;

function StyleFieldRow({ label, htmlFor, labelId, children }: {
  label: string; htmlFor?: string; labelId?: string; children: ReactNode;
}) {
  return <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-3">
    <Label id={labelId} htmlFor={htmlFor}>{label}</Label>
    {children}
  </div>;
}

export function StyleColorField({ label, value, onChange }: {
  label: string; value: string; onChange: (color: string) => void;
}) {
  const id = useId();
  return <StyleFieldRow label={label} htmlFor={id}>
    <div className="flex min-w-0 items-center gap-2">
      <Input id={id} type="color" value={value} onChange={event => onChange(event.target.value.toUpperCase())}
        className="w-14 shrink-0 cursor-pointer p-1" />
      <span className="font-mono text-xs text-slate-500">{value.toUpperCase()}</span>
    </div>
  </StyleFieldRow>;
}

export function StyleOptionalColorField({ label, value, mixedLabel, resetLabel, onChange }: {
  label: string; value: string | null; mixedLabel: string; resetLabel: string;
  onChange: (color: string | null) => void;
}) {
  const id = useId();
  return <StyleFieldRow label={label} htmlFor={id}>
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative h-10 w-11 shrink-0 rounded-md border bg-white p-1 focus-within:ring-2 focus-within:ring-ring">
        {/* The split swatch represents per-level colors, rather than a selected color. */}
        <span aria-hidden="true" className="block h-full w-full overflow-hidden rounded-sm" style={value
          ? { backgroundColor: value }
          : { background: "linear-gradient(45deg, #F23645 50%, #089981 50%)" }} />
        <Input id={id} type="color" value={value ?? "#2962FF"}
          onChange={event => onChange(event.target.value.toUpperCase())}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </div>
      <span className={value ? "font-mono text-xs text-slate-500" : "text-xs text-slate-500"}>
        {value?.toUpperCase() ?? mixedLabel}
      </span>
      {value ? <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)}
        aria-label={resetLabel} title={resetLabel} className="shrink-0 text-slate-500">
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
      </Button> : null}
    </div>
  </StyleFieldRow>;
}

export function StyleOpacityField({ label, value, onChange, invalid, describedBy }: {
  label: string; value: number; onChange: (opacity: number) => void; invalid?: boolean; describedBy?: string;
}) {
  const id = useId();
  return <StyleFieldRow label={label} htmlFor={id}>
    <div className="flex min-w-0 items-center gap-3">
      <Input id={id} type="range" min={0} max={100} step={1} value={value}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        onChange={event => onChange(event.target.valueAsNumber)} className="min-w-0 flex-1 border-0 px-0" />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-500">{formatPercent(value)}</span>
    </div>
  </StyleFieldRow>;
}

export function StyleChoiceField<T extends string | number>({ label, value, options, onChange, compact = false }: {
  label: string; value: T; options: readonly { value: T; label: string; preview?: ReactNode }[];
  onChange: (value: T) => void; compact?: boolean;
}) {
  const id = useId();
  return <StyleFieldRow label={label} labelId={id}>
    <div role="group" aria-labelledby={id} className={compact ? "flex gap-1" : "grid auto-cols-fr grid-flow-col gap-1"}>
      {options.map(option => <Button key={option.value} type="button" variant="outline"
        aria-label={option.label} aria-pressed={value === option.value} title={option.label}
        onClick={() => onChange(option.value)}
        className={cn("min-w-0 px-2 text-xs", compact && "w-10 shrink-0", value === option.value && "border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100")}>
        {option.preview ?? option.label}
      </Button>)}
    </div>
  </StyleFieldRow>;
}

export function StyleLineWidthField({ label, value, onChange }: {
  label: string; value: number; onChange: (width: number) => void;
}) {
  return <StyleChoiceField label={label} value={value} onChange={onChange} compact
    options={[1, 2, 3, 4].map(width => ({ value: width, label: `${label} ${width} px`,
      preview: <span className="block w-5 bg-slate-700" style={{ height: width }} aria-hidden="true" /> }))} />;
}

export function StyleTemplateField({ value, templates, onChange, onDelete }: {
  value: string; templates: readonly { id: string; name: string }[];
  onChange: (id: string) => void; onDelete: () => void;
}) {
  const id = useId();
  return <StyleFieldRow label={copy.marketReplay.drawingTemplate} htmlFor={id}>
    <div className="flex min-w-0 gap-2">
      <Select value={value || "__none"} onValueChange={onChange}>
        <SelectTrigger id={id} className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none" disabled>{templates.length ? copy.marketReplay.chooseDrawingTemplate : copy.marketReplay.noDrawingTemplates}</SelectItem>
          {templates.map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="icon" disabled={!value} onClick={onDelete}
        aria-label={copy.marketReplay.deleteDrawingTemplate} className="shrink-0 text-slate-500 hover:bg-red-50 hover:text-red-600">
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  </StyleFieldRow>;
}
