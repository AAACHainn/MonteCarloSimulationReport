import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GrowthProgress } from "@/lib/user-growth/types";

// User-module realm colors are categorical, independent of trading gain/loss.
const realmStyles = {
  mortal: "border-slate-200 dark:border-border bg-slate-100 dark:bg-muted text-slate-700 dark:text-secondary-text",
  qi: "border-emerald-200 dark:border-positive/40 bg-emerald-50 dark:bg-positive-background text-emerald-700 dark:text-positive",
  foundation: "border-blue-200 dark:border-link/40 bg-blue-50 dark:bg-info-background text-blue-700 dark:text-link",
};
export function RealmBadge({ realm = "mortal", children, className }: { realm?: GrowthProgress["realm"]; children: ReactNode; className?: string }) {
  return <Badge className={cn(realmStyles[realm], className)}>{children}</Badge>;
}
