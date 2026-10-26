"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { copy } from "@/lib/i18n";
import { UserSelector } from "./user-selector";
import { writeProfile } from "./profile-save";
import { ProfileDialog } from "./profile-dialog";
import { useCurrentUser } from "./user-context";
import { OwnershipContext } from "./ownership-context";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
export function UserEntry({ compact = false, session }: { compact?: boolean; session?: ReplaySessionSummary } = {}) {
  const current = useCurrentUser(), router = useRouter(), pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const displayed = session ? current.users.find(user => user.id === session.userId) ?? (session.owner ? { id: session.owner.id, nickname: session.owner.nickname, avatar: { preset: -1, zoom: 1, x: 50, y: 50 }, realmLabel: "" } : undefined) : current.selected;
  const profileId = session ? session.userId : current.selectedId;
  return <>
    <UserSelector allowSwitch={!session} compact={compact} context={session ? <OwnershipContext session={session} /> : undefined} users={current.users} selected={displayed} state={current.state} notice={current.notice} onRetry={current.refresh} onSelect={id => {
      if (session) return;
      current.select(id);
      // Follow explicit profile switches; direct links and replay ownership remain independent.
      if (/^\/users\/[^/]+\/?$/.test(pathname)) router.push(id ? `/users/${encodeURIComponent(id)}` : "/users");
    }} onCreate={() => setCreating(true)} onProfiles={() => router.push(profileId ? `/users/${encodeURIComponent(profileId)}` : "/users")} />
    {creating && <ProfileDialog description={copy.userGrowth.profileAvatarHint} onClose={() => setCreating(false)} onSave={async (nickname, avatar, image) => {
      try {
        const user = await writeProfile(nickname, avatar, image);
        current.upsert(user); current.select(user.id); current.refresh(); setCreating(false); router.push(`/users/${encodeURIComponent(user.id)}`); return null;
      } catch (cause) { return cause instanceof Error ? cause.message : copy.userGrowth.requestFailed; }
    }} />}
  </>;
}
