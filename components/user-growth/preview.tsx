"use client";

import { useRef, useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { makePreviewProfile, makePreviewRecordPage, previewSessions, previewUsers } from "@/lib/user-growth/preview-data";
import type { AvatarValue, GrowthProfile, GrowthRecord, ProfileSession, QueryState, UserIdentity } from "@/lib/user-growth/types";
import { ProfileView, sessionEligibility } from "./profile-view";
import { ProfileDialog } from "./profile-dialog";
import { UserAvatar } from "./user-avatar";
import { UserSelector } from "./user-selector";
import { GrowthRecordsDialog } from "./growth-records-dialog";
import { SessionOwnership } from "./session-ownership";

const t = copy.userGrowth;
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 650));

export function UserGrowthPreview() {
  const [users, setUsers] = useState(previewUsers);
  const [selection, setSelection] = useState<string | null>(null);
  const [viewed, setViewed] = useState("demo-0");
  const [userScenarios, setUserScenarios] = useState<Record<string, number>>({ "demo-0": 3, "demo-1": 0, "demo-2": 2 });
  const [query, setQuery] = useState<QueryState>("normal");
  const [emptyUsers, setEmptyUsers] = useState(false);
  const [failAction, setFailAction] = useState(false);
  const [brokenAvatar, setBrokenAvatar] = useState(false);
  const [list, setList] = useState(false);
  const [editor, setEditor] = useState<"create" | UserIdentity | null>(null);
  const [brokenThrough, setBrokenThrough] = useState<string[]>([]);
  const [newUsers, setNewUsers] = useState<string[]>([]);
  const [breaking, setBreaking] = useState(false);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [sessionContext, setSessionContext] = useState<{ session: ProfileSession; owner: UserIdentity | null } | null>(null);
  const [source, setSource] = useState<GrowthRecord | null>(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsPage, setRecordsPage] = useState(1);
  const nextId = useRef(1);
  const user = users.find((u) => u.id === viewed) ?? users[0];
  const scenario = userScenarios[user.id] ?? 0;
  const selected = users.find((u) => u.id === selection);
  const hasBrokenThrough = brokenThrough.includes(user.id);
  const activeScenario = newUsers.includes(user.id) ? 0 : hasBrokenThrough ? 6 : scenario;
  const profile: GrowthProfile = makePreviewProfile(user, activeScenario);
  if (brokenAvatar) profile.user.avatar = { ...profile.user.avatar, src: "/preview-avatar-unavailable.png" };
  const recordScenario = newUsers.includes(user.id) ? 0 : scenario;
  if (hasBrokenThrough) {
    const recent = makePreviewRecordPage(recordScenario, 1, true);
    profile.records = recent.items.slice(0, 5); profile.recordCount = recent.total;
  }
  // A breakthrough changes the displayed realm only. The same accumulated facts remain intact.
  if (hasBrokenThrough) {
    const original = makePreviewProfile(user, scenario);
    profile.totalXp = original.totalXp; profile.conditions = original.conditions;
  }
  const visibleUsers = emptyUsers ? [] : users.map((u) => {
    const view = u.id === user.id ? profile : makePreviewProfile(u, brokenThrough.includes(u.id) ? 6 : userScenarios[u.id] ?? 0);
    return { ...view.user, growth: { realm: view.realm, totalXp: view.totalXp, segment: view.segment } };
  });
  const selectedDisplay = emptyUsers ? undefined : visibleUsers.find((u) => u.id === selection) ?? selected;
  const choose = (id: string | null) => { setSelection(id); setStatus(""); };
  const openProfile = (id: string) => { setViewed(id); setList(false); setActionError(""); setStatus(""); };
  const saveProfile = async (nickname: string, avatar: AvatarValue) => {
    if (users.some((u) => u.id !== (editor === "create" ? undefined : editor?.id) && u.nickname === nickname)) return t.nicknameError;
    await delay();
    if (failAction) return t.actionError;
    if (editor === "create") {
      const id = `demo-new-${nextId.current++}`;
      setUsers([...users, { id, nickname, avatar, realmLabel: t.mortal }]); setNewUsers([...newUsers, id]); setSelection(id); setViewed(id); setList(false); setEmptyUsers(false);
    } else if (editor) setUsers(users.map((u) => u.id === editor.id ? { ...u, nickname, avatar } : u));
    setEditor(null); setStatus(t.saved); return null;
  };
  const breakthrough = async () => {
    if (breaking || query !== "normal") return false;
    setBreaking(true); setActionError(""); await delay();
    setBreaking(false);
    if (failAction) { setActionError(t.actionError); return false; }
    setBrokenThrough([...brokenThrough, user.id]); setStatus(t.breakthroughSuccess); return true;
  };
  const reset = () => { setUsers(previewUsers); setSelection(null); setViewed("demo-0"); setUserScenarios({ "demo-0": 3, "demo-1": 0, "demo-2": 2 }); setQuery("normal"); setEmptyUsers(false); setFailAction(false); setBrokenAvatar(false); setList(false); setBrokenThrough([]); setNewUsers([]); setActionError(""); setStatus(""); };
  const selector = <UserSelector users={visibleUsers} selected={selectedDisplay} state={query} onRetry={() => setQuery("normal")} onSelect={choose} onCreate={() => setEditor("create")} onProfiles={() => selected ? openProfile(selected.id) : setList(true)} />;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5"><div><div className="flex flex-wrap items-center gap-3"><p className="font-mono text-sm tracking-wide text-blue-700">{t.preview}</p><Badge className="bg-white text-slate-600">{t.previewBadge}</Badge></div><p className="mt-2 max-w-3xl text-sm text-slate-600">{t.previewHint}</p></div>{selector}</div>
    <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer rounded-sm text-sm font-medium text-slate-700 focus-visible:ring-2 focus-visible:ring-ring">{t.previewControls}</summary><p className="mt-3 text-xs text-slate-600">{t.previewControlsHint}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="preview-scenario">{t.scenario}</Label><Select value={String(scenario)} disabled={breaking} onValueChange={(v) => { setUserScenarios({ ...userScenarios, [user.id]: Number(v) }); setBrokenThrough(brokenThrough.filter((id) => id !== user.id)); setNewUsers(newUsers.filter((id) => id !== user.id)); setActionError(""); setStatus(""); setList(false); }}><SelectTrigger id="preview-scenario"><SelectValue /></SelectTrigger><SelectContent>{t.scenarios.map((name, i) => <SelectItem key={i} value={String(i)}>{name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="preview-query">{t.regionState}</Label><Select value={query} disabled={breaking} onValueChange={(v) => setQuery(v as QueryState)}><SelectTrigger id="preview-query"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">{t.normal}</SelectItem><SelectItem value="loading">{t.loading}</SelectItem><SelectItem value="error">{t.failed}</SelectItem></SelectContent></Select></div></div>
      <div className="mt-4 flex flex-wrap gap-3"><CheckboxField checked={emptyUsers} onChange={(v) => { setEmptyUsers(v); setList(v); }}>{t.emptyUsers}</CheckboxField><CheckboxField checked={failAction} onChange={setFailAction}>{t.failAction}</CheckboxField><CheckboxField checked={brokenAvatar} onChange={setBrokenAvatar}>{t.brokenAvatar}</CheckboxField><Button variant="outline" onClick={reset} disabled={breaking}>{t.reset}</Button></div>
    </details>
    <Breadcrumbs items={list ? [{ label: t.profiles }] : [{ label: t.profiles }, { label: profile.user.nickname }]} />
    <div role="status" aria-live="polite" className={status ? "rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" : "sr-only"}>{status}</div>
    {list ? <Card className="shadow-none"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t.profiles}</CardTitle><Button onClick={() => setEditor("create")}>{t.create}</Button></div><CardDescription>{t.profileListHint}</CardDescription></CardHeader><CardContent>{visibleUsers.length ? <ul className="divide-y">{visibleUsers.map((u) => <li key={u.id} className="flex items-center gap-3 py-4"><UserAvatar avatar={u.avatar} realm={u.growth?.realm} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{u.nickname}</p><p className="mt-1 text-sm text-slate-600">{u.realmLabel}</p></div><Button variant="outline" onClick={() => openProfile(u.id)}>{t.openProfile}</Button></li>)}</ul> : <p className="border border-dashed p-6 text-sm text-slate-600">{t.noUsers}</p>}</CardContent></Card> : <ProfileView key={`${user.id}-${scenario}`} profile={profile} selected={selectedDisplay} state={query} onRetry={() => setQuery("normal")} onSwitch={() => choose(user.id)} onEdit={() => setEditor(profile.user)} onBreakthrough={breakthrough} breaking={breaking} actionError={actionError} onOpenSession={(session) => setSessionContext({ session, owner: user })} onSource={setSource} onAllRecords={() => { setRecordsPage(1); setRecordsOpen(true); }} />}
    <section className="rounded-lg border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="mb-3 text-base font-semibold">{t.sessionContext}</h2><SessionOwnership hasUsers={visibleUsers.length > 0} owner={previewUsers[1]} eligibility={t.growthSession} /></div><Button variant="outline" onClick={() => setSessionContext({ session: { ...previewSessions[0], eligibility: "growth" }, owner: emptyUsers ? null : previewUsers[1] })}>{t.openSession}</Button></div><p className="mt-4 border-t pt-3 text-sm text-slate-700">{t.newOwner}：{emptyUsers ? t.noCreatedUser : selectedDisplay?.nickname ?? t.unowned}</p><p className="mt-1 text-xs text-slate-600">{t.newOwnerHint}</p></section>
    {editor && <ProfileDialog user={editor === "create" ? undefined : editor} description={t.previewHint} onClose={() => setEditor(null)} onSave={saveProfile} />}
    <Dialog open={!!sessionContext} title={t.sessionContext} description={t.contextHint} onClose={() => setSessionContext(null)}>{sessionContext && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><strong className="text-sm">{sessionContext.session.name} · {sessionContext.session.market}</strong>{selector}</div><SessionOwnership hasUsers={visibleUsers.length > 0} owner={sessionContext.owner} eligibility={sessionEligibility(sessionContext.session)} /><p className="text-sm text-slate-700">{t.replayPosition}</p></div>}</Dialog>
    {recordsOpen && <GrowthRecordsDialog records={makePreviewRecordPage(recordScenario, recordsPage, hasBrokenThrough)} onPageChange={setRecordsPage} onSource={setSource} onClose={() => setRecordsOpen(false)} />}
    <Dialog open={!!source} title={t.sourceTitle} description={t.sourceHint} onClose={() => setSource(null)}>{source && <div className="space-y-3 text-sm"><p className="font-semibold">{source.title}</p><p>{source.detail}</p><p>{source.source}</p><p className="tabular-nums">{t.settledTime}：{source.settledAt}（{t.settlementTime}）</p><p className="tabular-nums">{t.replayTime}：{source.replayAt}</p></div>}</Dialog>
    <p className="text-xs text-slate-600">{t.previewHint}</p>
  </div>;
}
