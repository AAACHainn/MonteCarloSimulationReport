"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { copy } from "@/lib/i18n";
import { UserSelector } from "./user-selector";
import { ProfileDialog } from "./profile-dialog";
import { useCurrentUser } from "./user-context";
import { OwnershipContext } from "./ownership-context";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
export function UserEntry({ compact = false, session }: { compact?: boolean; session?: ReplaySessionSummary } = {}) {
  const current = useCurrentUser(), router = useRouter(), pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const displayed = session ? current.users.find(user => user.id === session.userId) ?? (session.owner ? { id: session.owner.id, nickname: session.owner.nickname, avatar: { preset: 0, zoom: 1, x: 50, y: 50 }, realmLabel: "" } : undefined) : current.selected;
  const profileId = session ? session.userId : current.selectedId;
  return <>
    <UserSelector allowSwitch={!session} compact={compact} context={session ? <OwnershipContext session={session} /> : undefined} users={current.users} selected={displayed} state={current.state} notice={current.notice} onRetry={current.refresh} onSelect={id => {
      if (session) return;
      current.select(id);
      // Follow explicit profile switches; direct links and replay ownership remain independent.
      if (/^\/users\/[^/]+\/?$/.test(pathname)) router.push(id ? `/users/${encodeURIComponent(id)}` : "/users");
    }} onCreate={() => setCreating(true)} onProfiles={() => router.push(profileId ? `/users/${encodeURIComponent(profileId)}` : "/users")} />
    {creating && <ProfileDialog defaultAvatarOnly description={copy.userGrowth.avatarPending} onClose={() => setCreating(false)} onSave={async nickname => {
      try {
        const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }) });
        const result = await response.json(); if (!response.ok) return result.error ?? copy.userGrowth.requestFailed;
        current.upsert(result.user); current.select(result.user.id); current.refresh(); setCreating(false); router.push(`/users/${encodeURIComponent(result.user.id)}`); return null;
      } catch { return copy.userGrowth.requestFailed; }
    }} />}
  </>;
}
