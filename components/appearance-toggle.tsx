"use client";

import { MoonStar, Sun } from "lucide-react";
import { useAppearance } from "@/components/appearance-provider";
import { Switch } from "@/components/ui/switch";
import { copy } from "@/lib/i18n";

export function AppearanceToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useAppearance();
  const dark = mode === "dark";
  const Icon = dark ? MoonStar : Sun;
  return <Switch checked={dark} onCheckedChange={checked => setMode(checked ? "dark" : "light")}
      aria-label={copy.appearance.darkAppearance}
      title={copy.appearance.toggleHint(copy.appearance[mode], dark ? copy.appearance.light : copy.appearance.dark)}
      className={compact ? "h-8 w-16 rounded-full" : "w-16 rounded-full"}
      trackClassName="relative h-8 w-16 border border-input bg-slate-200 shadow-inner dark:bg-input-background"
      trackContent={<span className={`absolute text-xs font-semibold text-slate-600 dark:text-secondary-text ${dark ? "left-1.5" : "right-1.5"}`}>{copy.appearance[mode]}</span>}
      thumbContent={<Icon className="h-4 w-4 text-slate-500 dark:text-input-background" aria-hidden="true" />}
      thumbClassName={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center border border-slate-400 bg-white shadow-md dark:border-secondary-text dark:bg-secondary-text ${dark ? "translate-x-8" : "translate-x-0.5"}`} />;
}
