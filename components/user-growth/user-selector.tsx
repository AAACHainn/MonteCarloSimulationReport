"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowLeft, ArrowRightLeft, Check, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RealmBadge } from "./realm-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionPopoverContent } from "@/components/ui/option-popover";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { QueryState, UserIdentity } from "@/lib/user-growth/types";
import { UserAvatar } from "./user-avatar";
import { ExperienceProgress } from "./experience-progress";

const t = copy.userGrowth;
export function UserSelector({ users, selected, onSelect, onCreate, onProfiles, state = "normal", onRetry, notice = "", compact = false, context, allowSwitch = true, onOpen }: {
  users: UserIdentity[]; selected?: UserIdentity; onSelect: (id: string | null) => void; onCreate: () => void; onProfiles: () => void; state?: QueryState; onRetry: () => void;
  notice?: string; compact?: boolean; context?: ReactNode; allowSwitch?: boolean; onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "users">("menu");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  const changeOpen = (value: boolean) => {
    if (value) { setPortalContainer(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null); onOpen?.(); }
    else { setView("menu"); setSearch(""); setSearchOpen(false); }
    setOpen(value);
  };
  const choose = (id: string | null) => { if (!allowSwitch) return; onSelect(id); changeOpen(false); };
  const selectedUser = users.find(user => user.id === selected?.id) ?? selected;
  const choices: Array<UserIdentity | null> = selectedUser ? [selectedUser, null, ...users.filter(user => user.id !== selectedUser.id)] : [null, ...users];
  const query = search.trim().toLocaleLowerCase();
  const visible = choices.filter(user => user === null || user.nickname.toLocaleLowerCase().includes(query));
  const closeSearch = () => { setSearch(""); setSearchOpen(false); searchButtonRef.current?.focus(); };
  const back = () => { setView("menu"); setSearch(""); setSearchOpen(false); };
  const listing = allowSwitch && view === "users";
  useEffect(() => { if (open) { if (view === "menu") switchRef.current?.focus(); else backRef.current?.focus(); } }, [open, view]);
  const avatar = (user?: UserIdentity, small = false) => user ? <UserAvatar avatar={user.avatar} size={small ? "compact" : "list"} /> : <span className={cn("flex shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-50 text-slate-600", small ? "h-5 w-5" : "h-8 w-8")}><Users className={small ? "h-3 w-3" : "h-4 w-4"} aria-hidden="true" /></span>;
  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Popover.Trigger asChild><Button ref={triggerRef} variant="ghost" size="icon" className={cn("shrink-0 rounded-full p-0", compact && "h-8 w-8")} title={`${t.selection}：${selected?.nickname ?? t.all}`} aria-label={`${t.selection}：${selected?.nickname ?? t.all}`}>
      {selected ? <UserAvatar avatar={selected.avatar} size={compact ? "list" : "control"} /> : <span className={cn("flex items-center justify-center rounded-full border border-slate-300 bg-slate-50 text-slate-600", compact ? "h-8 w-8" : "h-10 w-10")}><Users className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden="true" /></span>}
    </Button></Popover.Trigger>
    <Popover.Portal container={portalContainer ?? undefined}><OptionPopoverContent align="end" className="w-80 p-3" aria-label={listing ? t.switchUser : t.scope} onEscapeKeyDown={event => { if (listing && searchOpen) { event.preventDefault(); closeSearch(); } else if (listing) { event.preventDefault(); back(); } }}>
      {listing ? <>
        <div className="flex shrink-0 items-center gap-2"><Button ref={backRef} variant="ghost" size="icon" aria-label={t.backToUserMenu} title={t.backToUserMenu} onClick={back}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button><p className="flex-1 text-sm font-medium">{t.switchUser}</p><Button ref={searchButtonRef} variant="ghost" size="icon" aria-label={searchOpen ? t.closeSearch : t.search} title={searchOpen ? t.closeSearch : t.search} aria-expanded={searchOpen} aria-controls={searchOpen ? searchId : undefined} onClick={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }}><Search className="h-4 w-4" aria-hidden="true" /></Button></div>
        {searchOpen && <div className="shrink-0 pb-2 pt-1"><Label htmlFor={searchId} className="sr-only">{t.search}</Label><Input ref={searchRef} id={searchId} value={search} onChange={event => setSearch(event.target.value)} placeholder={t.searchPlaceholder} /></div>}
        <div className="my-2 min-h-0 max-h-64 space-y-1 overflow-y-auto" aria-busy={state === "loading"}>
          {visible.map(user => {
            const active = user ? selected?.id === user.id : !selected;
            return <Button key={user ? `user:${user.id}` : "global"} disabled={user !== null && state === "loading"} aria-pressed={active} variant="ghost" className={cn("h-auto min-h-14 w-full justify-start gap-3 whitespace-normal py-2 text-left", active && "bg-slate-100")} onClick={() => choose(user?.id ?? null)}>
              {avatar(user ?? undefined)}<span className="min-w-0 flex-1"><span className="block break-words">{user?.nickname ?? t.all}</span><span className="text-xs font-normal text-slate-600">{user?.realmLabel ?? t.global}</span></span>{active && <Check className="h-4 w-4 shrink-0" aria-label={t.selected} />}
            </Button>;
          })}
          {state === "normal" && !visible.some(user => user !== null) && <p className="p-3 text-sm text-slate-600">{users.length ? t.noResults : t.noUsers}</p>}
        </div>
      </> : <>
        <div className="flex shrink-0 items-center gap-3 px-2 py-3">{selected ? <UserAvatar avatar={selected.avatar} size="control" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-50 text-slate-600"><Users className="h-5 w-5" aria-hidden="true" /></span>}<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1"><p className="max-w-full break-words text-sm font-medium">{selected?.nickname ?? t.all}</p>{selected ? selected.realmLabel && <RealmBadge realm={selectedUser?.growth?.realm} className="shrink-0">{selected.realmLabel}</RealmBadge> : <p className="basis-full text-xs text-slate-600">{t.global}</p>}</div></div>
        {selectedUser?.growth && <div className="shrink-0 px-2 pb-3"><ExperienceProgress growth={selectedUser.growth} compact /></div>}
        {context && <div className="shrink-0 border-t px-2 py-3">{context}</div>}
        {allowSwitch && <Button ref={switchRef} variant="ghost" className="w-full justify-start gap-3" onClick={() => setView("users")}><ArrowRightLeft className="h-4 w-4" aria-hidden="true" />{t.switchUser}</Button>}
        <p className="shrink-0 border-t px-2 py-3 text-xs text-slate-600">{t.scopeHint}</p>
        <div className="flex shrink-0 justify-between gap-2"><Button variant="outline" onClick={() => { changeOpen(false); onCreate(); }}>{t.create}</Button><Button variant="ghost" onClick={() => { changeOpen(false); onProfiles(); }}>{t.profiles}</Button></div>
      </>}
      {notice && <p role="status" className="shrink-0 px-2 pt-2 text-sm text-slate-600">{notice}</p>}
      {state !== "normal" && <p className="p-2 text-sm text-slate-600" role={state === "error" ? "alert" : "status"}>{state === "loading" ? t.loadingUsers : t.failedUsers}</p>}
      {state === "error" && <Button variant="outline" onClick={onRetry}>{t.retry}</Button>}
    </OptionPopoverContent></Popover.Portal>
  </Popover.Root>;
}
