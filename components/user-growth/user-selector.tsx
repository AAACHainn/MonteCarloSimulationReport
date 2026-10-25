"use client";

import { useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionPopoverContent } from "@/components/ui/option-popover";
import { copy } from "@/lib/i18n";
import type { QueryState, UserIdentity } from "@/lib/user-growth/types";
import { UserAvatar } from "./user-avatar";

const t = copy.userGrowth;
export function UserSelector({ users, selected, onSelect, onCreate, onProfiles, state = "normal", onRetry, notice = "" }: {
  users: UserIdentity[]; selected?: UserIdentity; onSelect: (id: string | null) => void; onCreate: () => void; onProfiles: () => void; state?: QueryState; onRetry: () => void;
  notice?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const choose = (id: string | null) => { onSelect(id); setOpen(false); setSearch(""); };
  return <Popover.Root open={open} onOpenChange={(value) => { if (value) setPortalContainer(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null); setOpen(value); }}>
    <Popover.Trigger asChild><Button ref={triggerRef} variant="ghost" size="icon" className="shrink-0 rounded-full p-0" title={`${t.selection}：${selected?.nickname ?? t.all}`} aria-label={`${t.selection}：${selected?.nickname ?? t.all}`}>
      {selected ? <UserAvatar avatar={selected.avatar} size="control" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-slate-50 text-slate-600"><Users className="h-5 w-5" aria-hidden="true" /></span>}
    </Button></Popover.Trigger>
    <Popover.Portal container={portalContainer ?? undefined}><OptionPopoverContent align="end" className="w-80 p-3" aria-label={t.scope}>
      <p className="px-2 py-2 text-xs text-slate-600">{t.scope}</p>
      {notice && <p role="status" className="px-2 pb-2 text-sm text-slate-600">{notice}</p>}
      <Button variant="ghost" className="h-auto min-h-10 w-full justify-between whitespace-normal text-left" onClick={() => choose(null)}><span><span className="block">{t.all}</span><span className="text-xs font-normal text-slate-600">{t.global}</span></span>{!selected && <Check className="h-4 w-4" aria-label={t.selected} />}</Button>
      <div className="my-3 border-t" />
      <Label htmlFor={searchId} className="mb-2">{t.search}</Label><Input id={searchId} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.searchPlaceholder} />
      <div className="my-2 max-h-64 space-y-1 overflow-y-auto" aria-busy={state === "loading"}>
        {state !== "normal" && <p className="p-2 text-sm text-slate-600" role={state === "error" ? "alert" : "status"}>{state === "loading" ? t.loadingUsers : t.failedUsers}</p>}
        {state === "error" && <Button variant="outline" onClick={onRetry}>{t.retry}</Button>}
        {users.filter((u) => u.nickname.includes(search.trim())).map((user) => <Button key={user.id} disabled={state === "loading"} variant="ghost" className="h-auto min-h-10 w-full justify-start gap-3 whitespace-normal py-2 text-left" onClick={() => choose(user.id)}><UserAvatar avatar={user.avatar} /><span className="min-w-0 flex-1"><span className="block break-words">{user.nickname}</span><span className="text-xs font-normal text-slate-600">{user.realmLabel}</span></span>{selected?.id === user.id && <Check className="h-4 w-4 shrink-0" aria-label={t.selected} />}</Button>)}
        {state === "normal" && !users.some((u) => u.nickname.includes(search.trim())) && <p className="p-3 text-sm text-slate-600">{users.length ? t.noResults : t.noUsers}</p>}
      </div><p className="border-t px-2 py-3 text-xs text-slate-600">{t.scopeHint}</p>
      <div className="flex justify-between gap-2"><Button variant="outline" onClick={() => { setOpen(false); onCreate(); }}>{t.create}</Button><Button variant="ghost" onClick={() => { setOpen(false); onProfiles(); }}>{t.profiles}</Button></div>
    </OptionPopoverContent></Popover.Portal>
  </Popover.Root>;
}
