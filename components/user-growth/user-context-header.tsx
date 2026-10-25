"use client";

import type { ReactNode } from "react";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import { UserEntry } from "./user-entry";

/** Keep the user control at the top right without a separate scope toolbar. */
export function UserContextHeader({ children, session }: { children?: ReactNode; session?: ReplaySessionSummary }) {
  return <div className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1">{children}</div>
    <UserEntry compact session={session} />
  </div>;
}
