"use client";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
type Transfer = { sessionId: string; name: string; kind: "DEPOSIT" | "WITHDRAW"; preview: SessionWalletPreview; requestId: string; value: string; confirming: boolean };
export function WalletPanel({ userId }: { userId: string }) {
  const current = useCurrentUser(), entry = useReplaySessionEntry(), inputId = useId();
  const [data, setData] = useState<UserWalletView | null>(null), [view, setView] = useState<"accounts" | "ledger" | null>(null);
  const [page, setPage] = useState(1), [accountsPage, setAccountsPage] = useState(1), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  const [transfer, setTransfer] = useState<Transfer | null>(null), [transferError, setTransferError] = useState("");
  useEffect(() => { const refresh = () => setRevision(n => n + 1); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void fetch(`/api/users/${encodeURIComponent(userId)}/wallet?page=${page}&accountsPage=${accountsPage}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.failed);
      if (!controller.signal.aborted) setData(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t.failed); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, page, accountsPage, revision]);
  async function readPreview(sessionId: string): Promise<SessionWalletPreview> {
    const response = await fetch(`/api/replay-sessions/${encodeURIComponent(sessionId)}/wallet`, { cache: "no-store" });
    const preview = await response.json(); if (!response.ok) throw new Error(preview.error ?? t.failed);
    if (preview.blocked) throw new Error(t.mustBeFlat);
    if (preview.settled) throw new Error(t.legacySettled);
    return preview;
  }
  async function beginTransfer(account: UserWalletView["accounts"][number], kind: Transfer["kind"]) {
    if (busy) return; setBusy(true); setError(""); setTransferError(""); setStatus("");
    try { const preview = await readPreview(account.sessionId); setTransfer({ sessionId: account.sessionId, name: account.name, kind, preview, requestId: createUuid(), value: "", confirming: false }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.failed); } finally { setBusy(false); }
  }
  async function refreshTransfer() {
    if (!transfer || busy) return; setBusy(true); setTransferError("");
    try { const preview = await readPreview(transfer.sessionId); setTransfer(old => old ? { ...old, preview, confirming: false } : old); setRevision(n => n + 1); }
    catch (cause) { setTransferError(cause instanceof Error ? cause.message : t.failed); } finally { setBusy(false); }
  }
  const maximum = transfer ? transfer.kind === "DEPOSIT" ? transfer.preview.available : transfer.preview.amount : 0;
  const value = Number(transfer?.value);
  const validAmount = !!transfer?.value && Number.isFinite(value) && value > 0 && value <= maximum && Number(value.toFixed(2)) === value;
  async function confirmTransfer() {
    if (!transfer || busy || !validAmount) return; setBusy(true); setTransferError("");
    try {
      const response = await fetch(`/api/replay-sessions/${encodeURIComponent(transfer.sessionId)}/wallet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, kind: transfer.kind, amount: value, expectedVersion: transfer.preview.version, requestId: transfer.requestId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.failed);
      setStatus(transfer.kind === "DEPOSIT" ? t.depositSuccess : t.withdrawSuccess); setTransfer(null); current.refresh(); setRevision(n => n + 1);
    } catch (cause) { setTransferError(cause instanceof Error ? cause.message : t.failed); }
    finally { setBusy(false); }
  }
  const feedback = <>{loading && <p role="status" className="text-sm text-slate-600">{t.loading}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}<Button variant="outline" className="ml-2" onClick={() => setRevision(n => n + 1)} disabled={loading || busy}>{t.retry}</Button></p>}</>;
  return <>
    <Card aria-busy={loading}><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t.title}</CardTitle><div className="flex gap-2"><Button variant="outline" onClick={() => setView("accounts")}>{t.accounts}</Button><Button variant="outline" onClick={() => setView("ledger")}>{t.ledger}</Button></div></div><CardDescription>{t.hint}</CardDescription></CardHeader><CardContent className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">{[[t.available, data?.available], [t.held, data?.held]].map(([label, amount]) => <div key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums">{typeof amount === "number" ? money(amount) : copy.common.dash}</p></div>)}</div>
      {!view && feedback}{status && <p role="status" className="text-sm text-emerald-700">{status}</p>}
    </CardContent></Card>
    <Dialog open={!!view && !transfer} title={view === "accounts" ? t.accounts : t.ledger} className="max-w-4xl" onClose={() => { if (!busy) setView(null); }}><div className="space-y-4" aria-busy={loading || busy}>{feedback}{busy && <p role="status" className="text-sm text-slate-600">{t.loading}</p>}{status && <p role="status" className="text-sm text-emerald-700">{status}</p>}
      {view === "accounts" ? <><p className="text-xs text-slate-600">{t.transferHint}</p><Table><TableHeader><TableRow><TableHead>{t.source}</TableHead><TableHead className="text-right">{t.accumulatedDeposit}</TableHead><TableHead className="text-right">{t.balance}</TableHead><TableHead>{t.actions}</TableHead></TableRow></TableHeader><TableBody>{data?.accounts.map(account => <TableRow key={account.id}><TableCell className="max-w-48 break-words">{account.name}{account.status === "ARCHIVED" && <p className="mt-1 text-xs text-slate-500">{t.archivedDeposit}</p>}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{money(account.deposited)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{money(account.balance)}</TableCell><TableCell><div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" disabled={busy || entry.busy} onClick={() => void entry.open({ sessionId: account.sessionId })}>{t.open}</Button><Button variant="outline" size="sm" disabled={busy || loading || account.balance <= 0} onClick={() => void beginTransfer(account, "WITHDRAW")}>{t.withdraw}</Button><Button variant="outline" size="sm" disabled={busy || loading || account.status !== "ACTIVE" || !data.available} onClick={() => void beginTransfer(account, "DEPOSIT")}>{t.depositAction}</Button></div>{account.balance <= 0 && <p className="mt-1 text-xs text-slate-500">{t.noTradingCapital}</p>}</TableCell></TableRow>)}</TableBody></Table>{!loading && !data?.accounts.length && <p className="text-sm text-slate-600">{t.empty}</p>}{data?.available === 0 && <p className="text-xs text-slate-500">{t.noTransferFunds}</p>}</> : <><p className="text-xs text-slate-500">{t.time}</p><Table><TableHeader><TableRow><TableHead>{t.source}</TableHead><TableHead>{t.time}</TableHead><TableHead className="text-right">{t.amount}</TableHead><TableHead className="text-right">{t.after}</TableHead></TableRow></TableHeader><TableBody>{data?.entries.map(row => <TableRow key={row.id}><TableCell><p>{t.types[row.type as keyof typeof t.types] ?? row.type}</p><p className="mt-1 max-w-64 break-words text-xs text-slate-500">{row.sessionName}{row.roundNumber ? ` · ${copy.propPractice.roundLabel(row.roundNumber)}` : ""}</p></TableCell><TableCell className="whitespace-nowrap text-xs tabular-nums">{new Date(row.time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{row.amount > 0 ? "+" : ""}{money(row.amount)}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{money(row.after)}</TableCell></TableRow>)}</TableBody></Table>{!loading && !data?.entries.length && <p className="text-sm text-slate-600">{t.empty}</p>}</>}
      {data && <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm"><span>{t.page(view === "accounts" ? data.accountsPage : data.page, Math.max(1, Math.ceil((view === "accounts" ? data.accountsTotal : data.total) / 20)))}</span><div className="flex gap-2"><Button variant="outline" disabled={loading || busy || (view === "accounts" ? data.accountsPage : data.page) <= 1} onClick={() => view === "accounts" ? setAccountsPage(data.accountsPage - 1) : setPage(data.page - 1)}>{t.previous}</Button><Button variant="outline" disabled={loading || busy || (view === "accounts" ? data.accountsPage * 20 >= data.accountsTotal : data.page * 20 >= data.total)} onClick={() => view === "accounts" ? setAccountsPage(data.accountsPage + 1) : setPage(data.page + 1)}>{t.next}</Button></div></div>}
    </div></Dialog>
    <Dialog open={!!transfer && !transfer.confirming} title={transfer?.kind === "DEPOSIT" ? t.depositTitle : t.withdrawTitle} description={t.transferHint} className="max-w-md" onClose={() => { if (!busy) setTransfer(null); }}>
      <form className="space-y-4" aria-busy={busy} onSubmit={event => { event.preventDefault(); if (validAmount && !busy) setTransfer(old => old ? { ...old, confirming: true } : old); else setTransferError(t.transferInvalid); }}>
        <p className="break-words text-sm font-medium">{transfer?.name}</p>
        <div className="grid grid-cols-2 gap-4 text-sm tabular-nums"><div><p className="text-xs text-slate-500">{t.available}</p><p className="mt-1">{money(transfer?.preview.available ?? 0)}</p></div><div><p className="text-xs text-slate-500">{t.balance}</p><p className="mt-1">{money(transfer?.preview.balance ?? 0)}</p></div></div>
        <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor={inputId}>{t.transferAmount}</Label><Button type="button" size="sm" variant="ghost" disabled={busy || maximum <= 0} onClick={() => setTransfer(old => old ? { ...old, value: maximum.toFixed(2), requestId: createUuid() } : old)}>{t.all}</Button></div><Input id={inputId} type="number" min="0.01" max={maximum} step="0.01" value={transfer?.value ?? ""} required disabled={busy} aria-describedby={`${inputId}-hint ${inputId}-error`} aria-invalid={!!transferError} onChange={event => { const value = event.target.value; setTransfer(old => old ? { ...old, value, requestId: createUuid() } : old); setTransferError(""); }} /><p id={`${inputId}-hint`} className="text-xs text-slate-500">{t.transferMaximum(formatNumber(maximum))}</p></div>
        {transferError && <p id={`${inputId}-error`} role="alert" className="text-sm text-red-700">{transferError}</p>}
        <div className="flex justify-end gap-2 border-t pt-4">{transferError && <Button type="button" variant="outline" disabled={busy} onClick={() => void refreshTransfer()}>{t.retry}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={() => setTransfer(null)}>{copy.common.cancel}</Button><Button type="submit" disabled={busy || !validAmount}>{copy.common.confirm}</Button></div>
      </form>
    </Dialog>
    <ConfirmDialog open={!!transfer?.confirming} title={transfer?.kind === "DEPOSIT" ? t.depositTitle : t.withdrawTitle} description={transfer ? (transfer.kind === "DEPOSIT" ? t.depositConfirm : t.withdrawConfirm)(formatNumber(value)) : ""} confirmLabel={transfer?.kind === "DEPOSIT" ? t.depositAction : t.withdraw} confirmVariant="default" isLoading={busy} error={transferError} secondaryAction={transferError ? { label: t.retry, onClick: () => void refreshTransfer() } : undefined} onCancel={() => setTransfer(old => old ? { ...old, confirming: false } : old)} onConfirm={() => void confirmTransfer()} />{entry.ui}
  </>;
}
