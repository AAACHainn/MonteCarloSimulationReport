import type { ReactNode } from "react";
import { copy } from "@/lib/i18n";
import { formatInteger as fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GrowthProgress } from "@/lib/user-growth/types";
import styles from "./user-growth.module.css";

const t = copy.userGrowth;
export function ExperienceProgress({ growth, compact = false, action }: { growth: GrowthProgress; compact?: boolean; action?: ReactNode }) {
  const segment = growth.segment;
  return <div className={cn(styles.theme, compact ? "text-xs" : "text-sm")}>
    {segment ? <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span>{t.segmentXp}<strong className="ml-2 font-mono tabular-nums">{fmt(segment.value)} / {fmt(segment.max)}</strong></span>{(!compact || action) && <div className="ml-auto flex flex-wrap items-center justify-end gap-3">{!compact && <span className="text-slate-700">{segment.value >= segment.max ? t.experienceMet : t.remainingXp(fmt(segment.max - segment.value))}</span>}{action}</div>}</div>
      <div role="progressbar" aria-label={t.segmentXp} aria-valuemin={0} aria-valuemax={segment.max} aria-valuenow={Math.min(segment.value, segment.max)} aria-valuetext={`${fmt(segment.value)} / ${fmt(segment.max)} ${t.xp}`} className={cn(styles.progress, "h-1.5 overflow-hidden rounded-full")}><div className={cn(styles.bar, "h-full rounded-full")} style={{ width: `${Math.min(100, segment.value / segment.max * 100)}%` }} /></div>
      {compact && <p className="mt-2 text-slate-600">{segment.value >= segment.max ? t.experienceMet : t.remainingXp(fmt(segment.max - segment.value))}</p>}
      <p className={cn(compact ? "mt-1" : "mt-3", "text-slate-700")}>{growth.realm === "mortal" ? t.nextMortal : t.nextLayer(segment.next)}</p>
      {!compact && growth.realm === "mortal" && <p className="mt-2 leading-6 text-slate-600">{t.mortalHint}</p>}
    </> : <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-slate-700">{t.foundationHint}</p>{action}</div>}
  </div>;
}
