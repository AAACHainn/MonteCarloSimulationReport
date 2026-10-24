"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { copy } from "@/lib/i18n";
import { formatMoney, formatQuantity, formatInteger } from "@/lib/format";
import { formatPriceForTick } from "@/lib/market-replay/price-ticks";
import type { listPropRounds } from "@/lib/prop-practice/rounds";
import type { PaperSessionSnapshot } from "@/lib/paper-trading/types";
import { FillHistory, OrderHistory } from "./paper-trading-panel";

export function PropRoundHistory({ datasetId, sessionId, rounds, selected }: { datasetId: string; sessionId: string; rounds: Awaited<ReturnType<typeof listPropRounds>>; selected: number }) {
  const t = copy.propPractice;
  const href = (number: number) => `/market-replay/${datasetId}/trade-history?sessionId=${encodeURIComponent(sessionId)}&propRound=${number}`;
  return <Card><CardHeader><CardTitle>{t.rounds}</CardTitle><CardDescription className="tabular-nums">
    {t.failedRounds}: {formatInteger(rounds.filter(round => round.result === "FAILED").length)} · {t.sessionReceived}: {formatMoney(rounds.reduce((sum, round) => sum + round.totalReceived, 0), rounds[0]?.currency)}
  </CardDescription></CardHeader><CardContent className="space-y-3">
    <Button asChild variant={selected === 0 ? "secondary" : "outline"}><Link href={href(0)}>{t.allRounds}</Link></Button>
    <Table><TableHeader><TableRow><TableHead>{t.round}</TableHead><TableHead>{t.pause}</TableHead><TableHead className="text-right">{t.equity}</TableHead><TableHead className="text-right">{t.totalReceived}</TableHead><TableHead className="text-right">{copy.paperTrading.journalTab}</TableHead><TableHead /></TableRow></TableHeader><TableBody>
      {rounds.map(round => <TableRow key={round.number} className={selected === round.number ? "bg-blue-50" : undefined}>
        <TableCell>{t.roundLabel(round.number)}{round.current ? ` · ${t.currentRound}` : ""}</TableCell>
        <TableCell>{round.phase === "EVALUATION" ? t.evaluation : t.funded} · {round.result === "FAILED" ? t.FAILED : round.result === "STOPPED" ? t.roundStopped : t[round.pause]}</TableCell>
        <TableCell className="text-right tabular-nums">{formatMoney(round.equity, round.currency)}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(round.totalReceived, round.currency)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatInteger(round.entryCount)}</TableCell><TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={href(round.number)}>{t.viewRound}</Link></Button></TableCell>
      </TableRow>)}
    </TableBody></Table>
  </CardContent></Card>;
}

export function PropRoundTradingRecords({ snapshot }: { snapshot: PaperSessionSnapshot }) {
  const [fillsOpen, setFillsOpen] = useState(false), t = copy.propPractice, p = copy.paperTrading;
  return <>
    <Card><CardHeader className="flex-row items-start justify-between gap-4 space-y-0"><div className="space-y-2"><CardTitle>{t.retainedTrades}</CardTitle><CardDescription>{t.roundFinishedHint}</CardDescription></div><Button variant="outline" onClick={() => setFillsOpen(true)}>{p.fillsTab}</Button></CardHeader>
      <CardContent className="space-y-4"><section className="space-y-2"><h3 className="text-sm font-medium">{t.openPositions}</h3>
        {snapshot.openLots?.length ? <Table><TableHeader><TableRow><TableHead>{p.time} · UTC</TableHead><TableHead>{p.side}</TableHead><TableHead className="text-right">{p.quantity}</TableHead><TableHead className="text-right">{p.price}</TableHead></TableRow></TableHeader><TableBody>{snapshot.openLots.map(lot => <TableRow key={lot.id}>
          <TableCell className="tabular-nums">{new Date(lot.openedAt).toLocaleString("zh-CN", { timeZone: "UTC" })}</TableCell><TableCell>{lot.side === "LONG" ? p.buy : p.sell}</TableCell><TableCell className="text-right tabular-nums">{formatQuantity(lot.remainingQuantity)}</TableCell><TableCell className="text-right tabular-nums">{formatPriceForTick(lot.entryPrice, lot.priceTickSize)}</TableCell>
        </TableRow>)}</TableBody></Table> : <p className="text-sm text-slate-500">{t.noOpenPositions}</p>}
      </section><section className="space-y-2 border-t pt-4"><h3 className="text-sm font-medium">{t.retainedOrders}</h3><OrderHistory snapshot={{ ...snapshot, recentOrders: [] }} /></section></CardContent>
    </Card>
    <Dialog open={fillsOpen} onClose={() => setFillsOpen(false)} title={p.fillsTab} className="max-w-4xl"><FillHistory snapshot={snapshot} /></Dialog>
  </>;
}
