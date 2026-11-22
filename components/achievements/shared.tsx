"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { achievementCatalog, type AchievementKey } from "@/lib/achievements/catalog";
import { formatInteger } from "@/lib/format";
import { copy, defaultLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const t = copy.achievements;
const dateFormat = new Intl.DateTimeFormat(defaultLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai", hour12: false });
export const achievementDate = (value: string | Date | null) => value ? dateFormat.format(new Date(value)) : copy.common.dash;
export const profileHref = (id: string) => `/users/${encodeURIComponent(id)}`;
export const collectionHref = (id: string) => `${profileHref(id)}/achievements`;
export const collectionApi = (id: string) => `/api${collectionHref(id)}`;

export async function achievementRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || t.error);
  return json as T;
}

export function useAchievementQuery<T>(url: string, wait = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await achievementRequest<T>(url, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t.error);
      } finally {
        if (wait && !controller.signal.aborted) timer = setTimeout(load, wait);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [url, wait, revision]);
  return { data, error, refresh: () => setRevision(value => value + 1) };
}

export function AchievementErrorAlert({ error, retry }: { error: string; retry?: () => void }) {
  return <Alert role="alert" className="border-negative/40 bg-negative-background text-negative">
    <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
      <span>{error}</span>{retry && <Button variant="outline" onClick={retry}>{t.retry}</Button>}
    </AlertDescription>
  </Alert>;
}

export function AchievementBadge({ id, level, compact = false }: { id: AchievementKey; level: number; compact?: boolean }) {
  const size = compact ? 36 : 48;
  return <span className={cn("relative inline-grid shrink-0 place-items-center", !compact && "h-14 w-14 rounded-md border bg-background")}>
    <Image src={`/achievements/${id}.svg`} width={size} height={size} alt="" unoptimized className={cn(level === 0 && "opacity-70 grayscale")} />
    {level > 0 && achievementCatalog[id].thresholds.length > 1 && <span aria-hidden="true" className="absolute bottom-0 right-0 grid h-5 min-w-5 place-items-center rounded-md border bg-card px-1 text-xs font-semibold tabular-nums text-foreground">{formatInteger(level)}</span>}
  </span>;
}
