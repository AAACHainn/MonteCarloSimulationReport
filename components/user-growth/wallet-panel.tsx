"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copy } from "@/lib/i18n";
import { formatMoney, formatNumber } from "@/lib/format";
import { createUuid } from "@/lib/uuid";
import type { UserWalletView } from "@/lib/user-wallet/read";
import type { SessionWalletPreview } from "@/lib/user-wallet/session";
import { useCurrentUser } from "./user-context";
import { useReplaySessionEntry } from "@/components/market-replay/replay-session-entry-guard";

const t = copy.userWallet, money = (value: number) => formatMoney(value, "USDT");
export function WalletPanel({ userId }: { userId: string }) {
  const current = useCurrentUser(), entry = useReplaySessionEntry();
  const [data, setData] = useState<UserWalletView | null>(null), [view, setView] = useState<"accounts" | "ledger" | null>(null);
  const [page, setPage] = useState(1), [accountsPage, setAccountsPage] = useState(1), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  const [withdraw, setWithdraw] = useState<{ sessionId: string; preview: SessionWalletPreview; requestId: string } | null>(null);
  useEffect(() => { const refresh = () => setRevision(n => n + 1); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void fetch(`/api/users/${encodeURIComponent(userId)}/wallet?page=${page}&accountsPage=${accountsPage}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.failed);
      if (!controller.signal.aborted) setData(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t.failed); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, page, accountsPage, revision]);
  async function beginWithdrawal(sessionId: string) {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}/wallet`, { cache: "no-store" }); const preview = await response.json(); if (!response.ok) throw new Error(preview.error ?? t.failed); if (preview.blocked) throw new Error(t.mustBeFlat); if (preview.settled) { setRevision(n => n + 1); return; } setWithdraw({ sessionId, preview, requestId: createUuid() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.failed); } finally { setBusy(false); }
  }
  async function confirmWithdrawal() {
    if (!withdraw || busy) return; setBusy(true); setError("");
    try { const response = await fetch(`/api/replay-sessions/${encodeURIComponent(withdraw.sessionId)}/wallet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: withdraw.preview.version, requestId: withdraw.requestId }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.failed); setWithdraw(null); setStatus(t.withdrawSuccess); current.refresh(); setRevision(n => n + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.failed); } finally { setBusy(false); }
  }
  const feedback = <>{loading && <p role="status" className="text-sm text-slate-600">{t.loading}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}<Button variant="outline" className="ml-2" onClick={() => setRevision(n => n + 1)} disabled={loading || busy}>{t.retry}</Button></p>}</>;
  return <>
    <Card aria-busy={loading}><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t.title}</CardTitle><div className="flex gap-2"><Button variant="outline" onClick={() => setView("accounts")}>{t.accounts}</Button><Button variant="outline" onClick={() => setView("ledger")}>{t.ledger}</Button></div></div><CardDescription>{t.hint}</CardDescription></CardHeader><CardContent className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">{[[t.available, data?.available], [t.held, data?.held]].map(([label, value]) => <div key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums">{typeof value === "number" ? money(value) : copy.common.dash}</p></div>)}</div>
      {!view && feedback}{status && <p role="status" className="text-sm text-emerald-700">{status}</p>}
    </CardContent></Card>
    <Dialog open={!!view && !withdraw} title={view === "accounts" ? t.accounts : t.ledger} className="max-w-3xl" onClose={() => { if (!busy) setView(null); }}><div className="space-y-4" aria-busy={loading || busy}>{feedback}
      {view === "accounts" ? <><Table><TableHeader><TableRow><TableHead>{t.source}</TableHead><TableHead className="text-right">{t.deposit}</TableHead><TableHead className="text-right">{t.balance}</TableHead><TableHead>{t.actions}</TableHead></TableRow></TableHeader><TableBody>{data?.accounts.map(account => <TableRow key={account.id}><TableCell className="max-w-64 break-words">{account.name}</TableCell><TableCell className="text-right tabular-nums">{money(account.deposited)}</TableCell><TableCell className="text-right tabular-nums">{money(account.balance)}</TableCell><TableCell><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={busy || entry.busy} onClick={() => void entry.open({ sessionId: account.sessionId })}>{t.open}</Button><Button variant="outline" size="sm" disabled={busy || loading} onClick={() => void beginWithdrawal(account.sessionId)}>{t.withdraw}</Button></div></TableCell></TableRow>)}</TableBody></Table>{!loading && !data?.accounts.length && <p className="text-sm text-slate-600">{t.empty}</p>}</> : <><p className="text-xs text-slate-500">{t.time}</p><Table><TableHeader><TableRow><TableHead>{t.source}</TableHead><TableHead>{t.time}</TableHead><TableHead className="text-right">{t.amount}</TableHead><TableHead className="text-right">{t.after}</TableHead></TableRow></TableHeader><TableBody>{data?.entries.map(row => <TableRow key={row.id}><TableCell><p>{t.types[row.type as keyof typeof t.types] ?? row.type}</p><p className="mt-1 max-w-64 break-words text-xs text-slate-500">{row.sessionName}{row.roundNumber ? ` · ${copy.propPractice.roundLabel(row.roundNumber)}` : ""}</p></TableCell><TableCell className="whitespace-nowrap text-xs tabular-nums">{new Date(row.time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</TableCell><TableCell className="text-right tabular-nums">{row.amount > 0 ? "+" : ""}{money(row.amount)}</TableCell><TableCell className="text-right tabular-nums">{money(row.after)}</TableCell></TableRow>)}</TableBody></Table>{!loading && !data?.entries.length && <p className="text-sm text-slate-600">{t.empty}</p>}</>}
      {data && <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm"><span>{t.page(view === "accounts" ? data.accountsPage : data.page, Math.max(1, Math.ceil((view === "accounts" ? data.accountsTotal : data.total) / 20)))}</span><div className="flex gap-2"><Button variant="outline" disabled={loading || busy || (view === "accounts" ? data.accountsPage : data.page) <= 1} onClick={() => view === "accounts" ? setAccountsPage(data.accountsPage - 1) : setPage(data.page - 1)}>{t.previous}</Button><Button variant="outline" disabled={loading || busy || (view === "accounts" ? data.accountsPage * 20 >= data.accountsTotal : data.page * 20 >= data.total)} onClick={() => view === "accounts" ? setAccountsPage(data.accountsPage + 1) : setPage(data.page + 1)}>{t.next}</Button></div></div>}
    </div></Dialog>
    <ConfirmDialog open={!!withdraw} title={t.withdrawTitle} description={withdraw ? t.withdrawConfirm(formatNumber(withdraw.preview.received)) : ""} confirmLabel={t.withdraw} confirmVariant="default" isLoading={busy} error={error} onCancel={() => { setWithdraw(null); setError(""); }} onConfirm={() => void confirmWithdrawal()} />{entry.ui}
  </>;
}
