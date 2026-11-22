"use client";

import type { ReactNode } from "react";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import { UserEntry } from "./user-entry";
import { StatusToast } from "@/components/ui/status-toast";
import { cn } from "@/lib/utils";

/** Keep the user control at the top right without a separate scope toolbar. */
export function UserContextHeader({ children, session, growthNotice, growthNoticeKey, className }: { children?: ReactNode; session?: ReplaySessionSummary; growthNotice?: string | null; growthNoticeKey?: number; className?: string }) {
  return <div className={cn("flex items-start justify-between gap-3", className)}>
    <div className="min-w-0 flex-1">{children}</div>
    <div className="shrink-0"><UserEntry compact session={session} growthFeedback={growthNotice && <StatusToast key={growthNoticeKey} message={growthNotice} />} /></div>
  </div>;
}
