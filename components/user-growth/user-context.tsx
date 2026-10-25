"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { copy } from "@/lib/i18n";
import type { QueryState, UserIdentity } from "@/lib/user-growth/types";

export const USER_SELECTION_KEY = "replay.currentUserId";
type UserContextValue = { users: UserIdentity[]; selected?: UserIdentity; selectedId: string | null; state: QueryState; hydrated: boolean; notice: string; select: (id: string | null) => void; refresh: () => void; upsert: (user: UserIdentity) => void };
const Context = createContext<UserContextValue>({ users: [], selectedId: null, state: "loading", hydrated: false, notice: "", select: () => {}, refresh: () => {}, upsert: () => {} });
export const useCurrentUser = () => useContext(Context);
export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<UserIdentity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<QueryState>("loading");
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState("");
  const idRef = useRef<string | null>(null), selectionRevision = useRef(0), requestRevision = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const select = useCallback((id: string | null) => {
    selectionRevision.current++; idRef.current = id; setSelectedId(id);
    try { if (id) localStorage.setItem(USER_SELECTION_KEY, id); else localStorage.removeItem(USER_SELECTION_KEY); }
    catch { setNotice(copy.userGrowth.storageUnavailable); }
  }, []);
  const refresh = useCallback(() => {
    activeRequest.current?.abort(); const controller = new AbortController(); activeRequest.current = controller;
    const revision = ++requestRevision.current, selectionAtStart = selectionRevision.current;
    setState("loading");
    void (async () => {
      try {
        const response = await fetch("/api/users", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.users)) throw new Error(copy.userGrowth.requestFailed);
        if (controller.signal.aborted || revision !== requestRevision.current) return;
        setUsers(result.users); setState("normal");
        // A response started before a newer selection or creation cannot invalidate it.
        if (selectionAtStart === selectionRevision.current && idRef.current && !result.users.some((user: UserIdentity) => user.id === idRef.current)) {
          select(null); setNotice(copy.userGrowth.selectionExpired);
        }
      } catch { if (!controller.signal.aborted && revision === requestRevision.current) setState("error"); }
    })();
  }, [select]);
  useEffect(() => {
    try { idRef.current = localStorage.getItem(USER_SELECTION_KEY) || null; setSelectedId(idRef.current); }
    catch { setNotice(copy.userGrowth.storageUnavailable); }
    setHydrated(true); refresh();
    const storage = (event: StorageEvent) => {
      if (event.key !== USER_SELECTION_KEY && event.key !== null) return;
      selectionRevision.current++; idRef.current = event.newValue || null; setSelectedId(idRef.current); refresh();
    };
    window.addEventListener("storage", storage); window.addEventListener("focus", refresh);
    return () => { activeRequest.current?.abort(); window.removeEventListener("storage", storage); window.removeEventListener("focus", refresh); };
  }, [refresh]);
  const upsert = useCallback((user: UserIdentity) => {
    requestRevision.current++; activeRequest.current?.abort();
    setUsers(items => items.some(item => item.id === user.id) ? items.map(item => item.id === user.id ? user : item) : [...items, user]); setState("normal");
  }, []);
  const selected = users.find(user => user.id === selectedId) ?? (selectedId ? { id: selectedId, nickname: copy.userGrowth.selectionUnknown, avatar: { preset: 0, zoom: 1, x: 50, y: 50 }, realmLabel: "" } : undefined);
  return <Context.Provider value={{ users, selected, selectedId, state, hydrated, notice, select, refresh, upsert }}>{children}</Context.Provider>;
}
