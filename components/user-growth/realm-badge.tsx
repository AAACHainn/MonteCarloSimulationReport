import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GrowthProgress } from "@/lib/user-growth/types";

// User-module realm colors are categorical, independent of trading gain/loss.
const realmStyles = {
  mortal: "border-slate-200 bg-slate-100 text-slate-700",
  qi: "border-emerald-200 bg-emerald-50 text-emerald-700",
  foundation: "border-blue-200 bg-blue-50 text-blue-700",
};
export function RealmBadge({ realm = "mortal", children, className }: { realm?: GrowthProgress["realm"]; children: ReactNode; className?: string }) {
  return <Badge className={cn(realmStyles[realm], className)}>{children}</Badge>;
}
