"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CheckboxField({ checked, onChange, disabled = false, children, className }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; children: ReactNode; className?: string }) {
  return <label className={cn("flex min-h-10 items-center gap-3 rounded-md border px-3 py-2 text-sm text-slate-800", disabled ? "cursor-default opacity-60" : "cursor-pointer hover:bg-slate-50", className)}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-blue-600 focus-visible:ring-2 focus-visible:ring-ring" />
    <span>{children}</span>
  </label>;
}
