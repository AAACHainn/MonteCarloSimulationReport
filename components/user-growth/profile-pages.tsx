"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";
import type { GrowthProfile, GrowthRecord, ProfileSession, UserIdentity } from "@/lib/user-growth/types";
import { useCurrentUser } from "./user-context";
import { WalletPanel } from "./wallet-panel";
import { UserAvatar } from "./user-avatar";
import { writeProfile } from "./profile-save";
import { ProfileDialog } from "./profile-dialog";
import { ProfileView } from "./profile-view";
import { GrowthHistory, GrowthSourceDialog } from "./growth-history";
import { useReplaySessionEntry } from "@/components/market-replay/replay-session-entry-guard";
const t = copy.userGrowth;
type SessionPage = { items: ProfileSession[]; page: number; total: number };
export function UserProfiles() {
  const current = useCurrentUser(), router = useRouter();
  const [creating, setCreating] = useState(false);
  return <div className="space-y-6"><Breadcrumbs items={[{ label: t.title }]} />
    <section className="flex items-end justify-between gap-4 border-b pb-6"><div><h1 className="text-3xl font-semibold tracking-tight text-slate-950">{t.title}</h1><p className="mt-2 text-sm text-slate-600">{t.profileListHint}</p></div><Button onClick={() => setCreating(true)}>{t.create}</Button></section>
    {current.notice && <p role="status" className="text-sm text-slate-600">{current.notice}</p>}
    {current.state === "loading" && <p role="status" className="text-sm text-slate-600">{t.loadingUsers}</p>}
    {current.state === "error" && <div role="alert" className="flex items-center gap-3 text-sm text-red-700">{t.failedUsers}<Button variant="outline" onClick={current.refresh}>{t.retry}</Button></div>}
    <div className="grid gap-4 md:grid-cols-2">{current.users.map(user => <Card key={user.id}><CardContent className="flex items-center gap-4 p-5"><UserAvatar avatar={user.avatar} realm={user.growth?.realm} /><div className="min-w-0 flex-1"><h2 className="break-words font-semibold">{user.nickname}</h2><p className="mt-1 text-sm text-slate-600">{user.realmLabel}</p></div><Button asChild variant="outline"><Link href={`/users/${encodeURIComponent(user.id)}`}>{t.openProfile}</Link></Button></CardContent></Card>)}</div>
    {current.state === "normal" && !current.users.length && <p className="rounded-lg border border-dashed p-6 text-sm text-slate-600">{t.noUsers}</p>}
    {creating && <ProfileDialog description={t.profileAvatarHint} onClose={() => setCreating(false)} onSave={async (nickname, avatar, image) => {
      try { const user = await writeProfile(nickname, avatar, image); current.upsert(user); current.select(user.id); current.refresh(); setCreating(false); router.push(`/users/${encodeURIComponent(user.id)}`); return null; }
      catch (error) { return error instanceof Error ? error.message : t.requestFailed; }
    }} />}
  </div>;
}

type ProfileData = { user: UserIdentity; sessions: SessionPage; growth: Omit<GrowthProfile, "user" | "sessions"> };
export function UserProfilePage({ userId }: { userId: string }) {
  const current = useCurrentUser();
  const entry = useReplaySessionEntry();
  const [data, setData] = useState<ProfileData | null>(null);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [state, setState] = useState<"normal" | "loading" | "error">("loading"), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [status, setStatus] = useState("");
  const [recordsOpen, setRecordsOpen] = useState(false), [source, setSource] = useState<GrowthRecord | null>(null);
  const [breaking, setBreaking] = useState(false), [actionError, setActionError] = useState("");
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setState("loading"); setError("");
    void fetch(`/api/users/${encodeURIComponent(userId)}?page=${page}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.requestFailed);
      if (!controller.signal.aborted) { setData(result); setState("normal"); }
    }).catch(cause => { if (!controller.signal.aborted) { setState("error"); setError(cause instanceof Error ? cause.message : t.requestFailed); } });
    return () => controller.abort();
  }, [userId, page, revision]);
  if (!data || data.user.id !== userId) return <div className="space-y-6"><Breadcrumbs items={[{ label: t.title, href: "/users" }]} /><p role={state === "error" ? "alert" : "status"}>{state === "error" ? error : t.loadingProfile}</p>{state === "error" && <Button variant="outline" onClick={() => setRevision(value => value + 1)}>{t.retry}</Button>}</div>;
  const profile: GrowthProfile = { ...data.growth, user: data.user, sessions: data.sessions.items };
  return <div className="space-y-6"><Breadcrumbs items={[{ label: t.title, href: "/users" }, { label: data.user.nickname }]} />
    {status && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{status}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}<Button variant="outline" className="ml-3" onClick={() => setRevision(value => value + 1)}>{t.retry}</Button></p>}
    <ProfileView key={userId} profile={profile} selected={current.selected} state={state} onRetry={() => setRevision(value => value + 1)} onSwitch={() => current.select(userId)} onEdit={() => setEditing(true)} walletContent={<WalletPanel userId={userId} />}
      onBreakthrough={async () => {
        if (breaking) return false; setBreaking(true); setActionError("");
        try {
          const response = await fetch(`/api/users/${encodeURIComponent(userId)}/breakthrough`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const result = await response.json(); if (!response.ok) { setRevision(value => value + 1); throw new Error(result.error ?? t.requestFailed); }
          setStatus(t.breakthroughSaved); setRevision(value => value + 1); current.refresh(); return true;
        } catch (cause) { setActionError(cause instanceof Error ? cause.message : t.requestFailed); return false; }
        finally { setBreaking(false); }
      }} breaking={breaking} actionError={actionError} onOpenSession={session => { if (!entry.busy) void entry.open({ sessionId: session.id }); }} onSource={setSource} onAllRecords={() => setRecordsOpen(true)} />
    <div className="flex items-center justify-between gap-3 text-sm"><span>{t.page(formatInteger(data.sessions.page), formatInteger(Math.max(1, Math.ceil(data.sessions.total / 20))))}</span><div className="flex gap-2"><Button variant="outline" disabled={state === "loading" || data.sessions.page <= 1} onClick={() => setPage(data.sessions.page - 1)}>{t.previous}</Button><Button variant="outline" disabled={state === "loading" || data.sessions.page * 20 >= data.sessions.total} onClick={() => setPage(data.sessions.page + 1)}>{t.next}</Button></div></div>
    {editing && <ProfileDialog user={data.user} description={t.profileAvatarHint} onClose={() => setEditing(false)} onSave={async (nickname, avatar, image) => {
      try { const user = await writeProfile(nickname, avatar, image, userId); current.upsert(user); current.refresh(); setData(old => old ? { ...old, user } : old); setEditing(false); setStatus(t.profileSaved); setRevision(value => value + 1); return null; }
      catch (cause) { return cause instanceof Error ? cause.message : t.requestFailed; }
    }} />}
    {entry.ui}
    {recordsOpen && <GrowthHistory key={`history:${userId}`} userId={userId} onClose={() => setRecordsOpen(false)} onSource={setSource} />}
    {source && <GrowthSourceDialog record={source} onClose={() => setSource(null)} />}
  </div>;
}
