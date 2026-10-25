"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { copy } from "@/lib/i18n";
import { UserSelector } from "./user-selector";
import { ProfileDialog } from "./profile-dialog";
import { useCurrentUser } from "./user-context";
export function UserEntry() {
  const current = useCurrentUser(), router = useRouter(), pathname = usePathname();
  const [creating, setCreating] = useState(false);
  return <>
    <UserSelector users={current.users} selected={current.selected} state={current.state} notice={current.notice} onRetry={current.refresh} onSelect={id => {
      current.select(id);
      // Follow explicit profile switches; direct links and replay ownership remain independent.
      if (/^\/users\/[^/]+\/?$/.test(pathname)) router.push(id ? `/users/${encodeURIComponent(id)}` : "/users");
    }} onCreate={() => setCreating(true)} onProfiles={() => router.push(current.selectedId ? `/users/${encodeURIComponent(current.selectedId)}` : "/users")} />
    {creating && <ProfileDialog defaultAvatarOnly description={copy.userGrowth.avatarPending} onClose={() => setCreating(false)} onSave={async nickname => {
      try {
        const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }) });
        const result = await response.json(); if (!response.ok) return result.error ?? copy.userGrowth.requestFailed;
        current.upsert(result.user); current.select(result.user.id); current.refresh(); setCreating(false); router.push(`/users/${encodeURIComponent(result.user.id)}`); return null;
      } catch { return copy.userGrowth.requestFailed; }
    }} />}
  </>;
}
