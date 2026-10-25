"use client";
import { useCurrentUser } from "./user-context";
import { copy } from "@/lib/i18n";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
export function eligibilityLabel(session: Pick<ReplaySessionSummary, "ownershipSource" | "growthEligible" | "mode">) {
  return session.ownershipSource === "HISTORICAL" ? copy.userGrowth.historical : session.growthEligible ? copy.userGrowth.eligibilityReserved : session.mode === "LIVE_REPLAY" ? copy.userGrowth.replayExcluded : copy.userGrowth.unownedHint;
}
export function OwnershipContext({ session }: { session: ReplaySessionSummary }) {
  const current = useCurrentUser();
  const ownerName = current.users.find(user => user.id === session.userId)?.nickname ?? session.owner?.nickname ?? (current.state === "normal" && !current.users.length ? copy.userGrowth.noCreatedUser : copy.userGrowth.unowned);
  return <div className="space-y-1 text-sm text-slate-700"><p>{copy.userGrowth.owner}：{ownerName} · {eligibilityLabel(session)}</p>
    {session.owner && session.userId !== current.selectedId && <p>{copy.userGrowth.ownerHint(ownerName)}</p>}
  </div>;
}
export function NewSessionOwner({ submittedName }: { submittedName?: string }) {
  const current = useCurrentUser();
  return <p className="text-sm text-slate-700">{copy.userGrowth.newSessionOwner}：{submittedName ?? current.selected?.nickname ?? (current.state === "normal" && !current.users.length ? copy.userGrowth.noCreatedUser : copy.userGrowth.unowned)}</p>;
}
