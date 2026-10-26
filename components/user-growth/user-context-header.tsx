"use client";

import type { ReactNode } from "react";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import { UserEntry } from "./user-entry";
import { GrowthSettlementToast } from "./growth-settlement-toast";

/** Keep the user control at the top right without a separate scope toolbar. */
export function UserContextHeader({ children, session, growthNotice, growthNoticeKey }: { children?: ReactNode; session?: ReplaySessionSummary; growthNotice?: string | null; growthNoticeKey?: number }) {
  return <div className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1">{children}</div>
    <div className="relative shrink-0"><UserEntry compact session={session} /><GrowthSettlementToast key={growthNoticeKey} message={growthNotice} /></div>
  </div>;
}
