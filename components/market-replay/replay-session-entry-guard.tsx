"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/components/user-growth/user-context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";

const t = copy.userGrowth;
export type ReplayEntryRequest = { sessionId: string; href?: string; beforeEnter?: () => Promise<boolean>; onEnter?: (session: ReplaySessionSummary) => void };
type Pending = { request: ReplayEntryRequest; session: ReplaySessionSummary };
export function needsOwnerSelection(session: Pick<ReplaySessionSummary, "userId">, selectedId: string | null) {
  return !!session.userId && session.userId !== selectedId;
}

/** Viewing consent only. Actual ownership and trading rules remain server-owned. */
export function useReplaySessionEntry() {
  const current = useCurrentUser(), router = useRouter();
  const selection = useRef(current.selectedId), select = useRef(current.select);
  selection.current = current.selectedId; select.current = current.select;
  const revision = useRef(0), controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => () => { revision.current++; controller.current?.abort(); }, []);
  const open = useCallback(async (request: ReplayEntryRequest, consent?: ReplaySessionSummary) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const requestRevision = ++revision.current; setBusy(true); setError("");
    const active = () => !abort.signal.aborted && revision.current === requestRevision;
    try {
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(request.sessionId)}`, { cache: "no-store", signal: abort.signal });
      const result = await response.json(); if (!response.ok || !result.session) throw new Error(result.error ?? t.entryFailed);
      if (!active()) return;
      const session: ReplaySessionSummary = result.session;
      if (consent && (session.userId !== consent.userId || session.owner?.nickname !== consent.owner?.nickname)) {
        setPending({ request, session }); setError(t.entryOwnerChanged); return;
      }
      if (!consent && needsOwnerSelection(session, selection.current)) { setPending({ request, session }); return; }
      if (request.beforeEnter && !await request.beforeEnter()) throw new Error(copy.replaySessions.switchFailed);
      if (!active()) return;
      // A selection can change while the source page finishes saving its pending work.
      if (!consent && needsOwnerSelection(session, selection.current)) { setPending({ request, session }); return; }
      if (session.userId && session.userId !== selection.current) select.current(session.userId);
      setPending(null);
      if (request.onEnter) request.onEnter(session);
      else router.push(request.href ?? `/market-replay/${encodeURIComponent(session.datasetId)}?sessionId=${encodeURIComponent(session.id)}`);
    } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : t.entryFailed); }
    finally { if (active()) setBusy(false); }
  }, [router]);
  const cancel = () => { revision.current++; controller.current?.abort(); setPending(null); setBusy(false); setError(""); };
  const owner = pending?.session.owner?.nickname ?? (pending?.session.userId ? t.loadingOwner : t.unowned);
  const ui = <>
    <ConfirmDialog open={!!pending} title={t.entryTitle} description={t.entryConfirm(owner, pending?.session.name ?? "")} confirmLabel={t.entryConfirmLabel} confirmVariant="default" isLoading={busy} error={error} onCancel={cancel} onConfirm={() => { if (pending) void open(pending.request, pending.session); }} />
    {!pending && error && <Alert role="alert" className="border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert>}
  </>;
  return { open, busy, pending: !!pending, error, ui };
}

/** Direct URLs and new-tab links must also obtain consent before mounting the replay. */
export function ReplaySessionGate({ session, children }: { session: ReplaySessionSummary; children: ReactNode }) {
  const current = useCurrentUser(), router = useRouter(), entry = useReplaySessionEntry();
  const { open } = entry;
  const [entered, setEntered] = useState(false);
  const request = useCallback(() => void open({ sessionId: session.id, onEnter: fresh => {
    if (fresh.activeProjectionId !== session.activeProjectionId || fresh.status !== session.status || fresh.userId !== session.userId || fresh.owner?.nickname !== session.owner?.nickname) router.refresh();
    else setEntered(true);
  } }), [open, router, session.id, session.activeProjectionId, session.status, session.userId, session.owner?.nickname]);
  useEffect(() => { if (current.hydrated) request(); }, [current.hydrated, request]);
  if (entered) return children;
  return <div className="space-y-6">
    <Card className="max-w-xl"><CardHeader><CardTitle>{t.entryTitle}</CardTitle><CardDescription>{session.name}</CardDescription></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-slate-600" role="status">{!current.hydrated || entry.busy ? t.entryChecking : t.entryPending}</p>
      <div className="flex flex-wrap gap-2"><Button disabled={!current.hydrated || entry.busy} onClick={request}>{t.entryRetry}</Button><Button asChild variant="outline"><Link href={`/market-replay/${encodeURIComponent(session.datasetId)}`}>{copy.replaySessions.allSessions}</Link></Button></div>
    </CardContent></Card>{entry.ui}
  </div>;
}
