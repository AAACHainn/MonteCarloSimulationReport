"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { copy } from "@/lib/i18n";
import { snapPriceToTick } from "@/lib/market-replay/price-ticks";
import type { MarketBarData } from "@/lib/market-replay/types";
import type { PaperOrderData, PaperOrderType, PaperSessionSnapshot, PaperSide } from "@/lib/paper-trading/types";

type OrderInput = {
  side: PaperSide;
  type: PaperOrderType;
  quantity: number;
  riskAmount?: number | null;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  reduceOnly?: boolean;
};

type Props = {
  priceTickSize: number;
  snapshot: PaperSessionSnapshot | null;
  currentBar: MarketBarData | null;
  busy: boolean;
  error: string | null;
  onCreate: (config: { initialCapital: number; currency: string; commissionBps: number; slippageBps: number }) => Promise<boolean>;
  onSubmit: (order: OrderInput) => Promise<boolean>;
  onCancel: (orderId: string) => Promise<boolean>;
  onUpdate: (orderId: string, update: { price?: number; quantity?: number; stopLoss?: number | null; takeProfit?: number | null; riskAmount?: number | null }) => Promise<boolean>;
  onCancelScope: (scope: "ALL" | "BRACKET") => Promise<boolean>;
  onClear: () => void;
};

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

function number(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

function orderTypeLabel(type: PaperOrderType) {
  return type === "MARKET" ? copy.paperTrading.market : type === "LIMIT" ? copy.paperTrading.limit : copy.paperTrading.stop;
}

function orderStatusLabel(status: PaperOrderData["status"]) {
  return status === "PENDING" ? copy.paperTrading.pending : status === "FILLED" ? copy.paperTrading.filled : status === "CANCELLED" ? copy.paperTrading.cancelled : copy.paperTrading.rejected;
}

function fillReasonLabel(reason: PaperSessionSnapshot["recentFills"][number]["reason"]) {
  const labels = { ENTRY: copy.paperTrading.entry, ADD: copy.paperTrading.add, REDUCE: copy.paperTrading.reduce, CLOSE: copy.paperTrading.close, REVERSE: copy.paperTrading.reverse, STOP_LOSS: copy.paperTrading.stopLossFill, TAKE_PROFIT: copy.paperTrading.takeProfitFill };
  return labels[reason];
}

export function PaperAccountStrip({ snapshot }: { snapshot: PaperSessionSnapshot | null }) {
  if (!snapshot) return null;
  const { session, stats } = snapshot;
  const position = session.netQuantity > 0 ? copy.paperTrading.long : session.netQuantity < 0 ? copy.paperTrading.short : copy.paperTrading.flat;
  const items = [
    [copy.paperTrading.balance, `${number(stats.balance)} ${session.currency}`],
    [copy.paperTrading.equity, `${number(stats.equity)} ${session.currency}`],
    [copy.paperTrading.realizedPnl, number(session.realizedPnl)],
    [copy.paperTrading.unrealizedPnl, number(stats.unrealizedPnl)],
    [copy.paperTrading.netPosition, `${position} ${number(Math.abs(session.netQuantity), 8)}`],
    [copy.paperTrading.averagePrice, session.averageEntryPrice == null ? "—" : number(session.averageEntryPrice, 8)],
    [copy.paperTrading.fees, number(session.totalFees)],
    [copy.paperTrading.maxDrawdown, `${number(session.maxDrawdown * 100)}%`],
  ];
  return (
    <Card><CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {items.map(([label, value]) => <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="font-medium text-slate-950">{value}</p></div>)}
    </CardContent></Card>
  );
}

export function PaperTradingPanel({ priceTickSize, snapshot, currentBar, busy, error, onCreate, onSubmit, onCancel, onUpdate, onCancelScope, onClear }: Props) {
  const [side, setSide] = useState<PaperSide>("BUY");
  const [type, setType] = useState<PaperOrderType>("MARKET");
  if (!snapshot) {
    return (
      <Card className="h-fit">
        <CardHeader className="pb-3"><CardTitle className="text-lg">{copy.paperTrading.title}</CardTitle><CardDescription>{copy.paperTrading.setupDescription}</CardDescription></CardHeader>
        <CardContent><form className="space-y-3" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void onCreate({ initialCapital: Number(data.get("initialCapital")), currency: String(data.get("currency")), commissionBps: Number(data.get("commissionBps")), slippageBps: Number(data.get("slippageBps")) });
        }}>
          <div><Label htmlFor="paper-capital">{copy.paperTrading.initialCapital}</Label><Input id="paper-capital" name="initialCapital" type="number" min="0.01" step="any" defaultValue="100000" required /></div>
          <div><Label htmlFor="paper-currency">{copy.paperTrading.currency}</Label><Input id="paper-currency" name="currency" defaultValue="USDT" maxLength={12} required /></div>
          <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="paper-fee">{copy.paperTrading.commissionBps}</Label><Input id="paper-fee" name="commissionBps" type="number" min="0" step="any" defaultValue="0" required /></div><div><Label htmlFor="paper-slip">{copy.paperTrading.slippageBps}</Label><Input id="paper-slip" name="slippageBps" type="number" min="0" step="any" defaultValue="0" required /></div></div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{busy ? copy.paperTrading.creating : copy.paperTrading.createAccount}</Button>
        </form></CardContent>
      </Card>
    );
  }

  const quantity = Math.abs(snapshot.session.netQuantity);
  return (
    <Card className="h-fit">
      <CardHeader className="pb-3"><CardTitle className="text-lg">{copy.paperTrading.title}</CardTitle><CardDescription>{copy.paperTrading.nextOpenHint}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          const price = optionalNumber(data.get("price")); const stopLoss = optionalNumber(data.get("stopLoss")); const takeProfit = optionalNumber(data.get("takeProfit"));
          void onSubmit({ side, type, quantity: Number(data.get("quantity")), price: price === null ? null : snapPriceToTick(price, priceTickSize), stopLoss: stopLoss === null ? null : snapPriceToTick(stopLoss, priceTickSize), takeProfit: takeProfit === null ? null : snapPriceToTick(takeProfit, priceTickSize) });
        }}>
          <div className="grid grid-cols-2 gap-2"><Button type="button" variant={side === "BUY" ? "default" : "outline"} onClick={() => setSide("BUY")} className={side === "BUY" ? "bg-emerald-600 hover:bg-emerald-700" : ""}>{copy.paperTrading.buy}</Button><Button type="button" variant={side === "SELL" ? "destructive" : "outline"} onClick={() => setSide("SELL")}>{copy.paperTrading.sell}</Button></div>
          <div><Label htmlFor="paper-type">{copy.paperTrading.orderType}</Label><Select value={type} onValueChange={(value) => setType(value as PaperOrderType)}><SelectTrigger id="paper-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MARKET">{copy.paperTrading.market}</SelectItem><SelectItem value="LIMIT">{copy.paperTrading.limit}</SelectItem><SelectItem value="STOP">{copy.paperTrading.stop}</SelectItem></SelectContent></Select></div>
          <div><Label htmlFor="paper-quantity">{copy.paperTrading.quantity}</Label><Input id="paper-quantity" name="quantity" type="number" min="0.00000001" step="any" defaultValue="1" required /></div>
          {type !== "MARKET" ? <div><Label htmlFor="paper-price">{copy.paperTrading.orderPrice}</Label><Input id="paper-price" name="price" type="number" step={priceTickSize} defaultValue={currentBar ? snapPriceToTick(currentBar.close, priceTickSize) : undefined} required /></div> : null}
          <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="paper-stop-loss">{copy.paperTrading.stopLoss}（{copy.paperTrading.optional}）</Label><Input id="paper-stop-loss" name="stopLoss" type="number" step={priceTickSize} /></div><div><Label htmlFor="paper-take-profit">{copy.paperTrading.takeProfit}（{copy.paperTrading.optional}）</Label><Input id="paper-take-profit" name="takeProfit" type="number" step={priceTickSize} /></div></div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={busy || !currentBar} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{busy ? copy.paperTrading.submitting : copy.paperTrading.submitOrder}</Button>
        </form>
        {quantity > 0 ? <div className="grid grid-cols-2 gap-2 border-t pt-3"><Button type="button" variant="outline" disabled={busy} onClick={() => void onSubmit({ side: snapshot.session.netQuantity > 0 ? "SELL" : "BUY", type: "MARKET", quantity, price: null, stopLoss: null, takeProfit: null, reduceOnly: true })}>{copy.paperTrading.closePosition}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void onSubmit({ side: snapshot.session.netQuantity > 0 ? "SELL" : "BUY", type: "MARKET", quantity: quantity * 2, price: null, stopLoss: null, takeProfit: null })}>{copy.paperTrading.reversePosition}</Button></div> : null}
        <div className="grid grid-cols-2 gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => void onCancelScope("ALL")}>{copy.paperTrading.cancelAll}</Button><Button type="button" variant="ghost" size="sm" onClick={() => void onCancelScope("BRACKET")}>{copy.paperTrading.cancelBracket}</Button></div>
        <ActiveOrders priceTickSize={priceTickSize} orders={snapshot.activeOrders} busy={busy} onCancel={onCancel} onUpdate={onUpdate} />
        <Button type="button" variant="ghost" size="sm" className="w-full text-red-600" onClick={onClear}><Trash2 className="h-4 w-4" />{copy.paperTrading.resetAccount}</Button>
      </CardContent>
    </Card>
  );
}

function ActiveOrders({ priceTickSize, orders, busy, onCancel, onUpdate }: { priceTickSize: number; orders: PaperOrderData[]; busy: boolean; onCancel: Props["onCancel"]; onUpdate: Props["onUpdate"] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!orders.length) return <p className="rounded-md border border-dashed p-3 text-xs text-slate-500">{copy.paperTrading.noOrders}</p>;
  return <div className="space-y-2 border-t pt-3">{orders.map((order) => <div key={order.id} className="rounded-md border bg-slate-50 p-2 text-xs"><div className="flex items-center justify-between gap-2"><div><span className={order.side === "BUY" ? "font-medium text-emerald-700" : "font-medium text-red-700"}>{order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell}</span> · {order.isProtective ? copy.paperTrading.protective : orderTypeLabel(order.type)} · {number(order.quantity, 8)} {order.price == null ? "" : `@ ${number(order.price, 8)}`}</div><button type="button" onClick={() => setOpenId(openId === order.id ? null : order.id)} aria-label={copy.paperTrading.edit}>{openId === order.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></div>{openId === order.id ? <form className="mt-2 grid grid-cols-[1fr_1fr_auto_auto] gap-1" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onUpdate(order.id, { ...(order.isProtective ? {} : { quantity: Number(data.get("quantity")) }), ...(order.price == null ? {} : { price: snapPriceToTick(Number(data.get("price")), priceTickSize) }) }); setOpenId(null); }}>{order.isProtective ? <span /> : <Input name="quantity" type="number" step="any" defaultValue={order.quantity} className="h-8" />}{order.price == null ? <span /> : <Input name="price" type="number" step={priceTickSize} defaultValue={order.price} className="h-8" />}<Button type="submit" size="sm" disabled={busy}>{copy.paperTrading.save}</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onCancel(order.id)}>{copy.paperTrading.cancel}</Button></form> : null}</div>)}</div>;
}

export function PaperTradingDetails({ snapshot }: { snapshot: PaperSessionSnapshot | null }) {
  const [tab, setTab] = useState<"orders" | "fills" | "stats">("orders");
  const [expanded, setExpanded] = useState(false);
  if (!snapshot) return null;
  return <Card className="shrink-0 overflow-hidden rounded-none border-x-0 border-b-0 shadow-none"><CardContent className="p-0"><div className="flex h-11 items-center gap-2 border-b px-3"><span className="mr-1 text-sm font-semibold text-slate-800">{copy.paperTrading.records}</span>{expanded ? <><Button size="sm" variant={tab === "orders" ? "default" : "ghost"} onClick={() => setTab("orders")}>{copy.paperTrading.ordersTab}</Button><Button size="sm" variant={tab === "fills" ? "default" : "ghost"} onClick={() => setTab("fills")}>{copy.paperTrading.fillsTab}</Button><Button size="sm" variant={tab === "stats" ? "default" : "ghost"} onClick={() => setTab("stats")}>{copy.paperTrading.statsTab}</Button></> : null}<Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}{expanded ? copy.paperTrading.collapseRecords : copy.paperTrading.expandRecords}</Button></div>{expanded ? <div className="h-48 overflow-auto p-3">{tab === "orders" ? <OrderHistory snapshot={snapshot} /> : tab === "fills" ? <FillHistory snapshot={snapshot} /> : <Stats snapshot={snapshot} />}</div> : null}</CardContent></Card>;
}

function OrderHistory({ snapshot }: { snapshot: PaperSessionSnapshot }) {
  const orders = [...snapshot.activeOrders, ...snapshot.recentOrders];
  if (!orders.length) return <p className="text-sm text-slate-500">{copy.paperTrading.noOrders}</p>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="p-2">{copy.paperTrading.side}</th><th className="p-2">{copy.paperTrading.orderType}</th><th className="p-2">{copy.paperTrading.quantity}</th><th className="p-2">{copy.paperTrading.price}</th><th className="p-2">{copy.paperTrading.status}</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b"><td className="p-2">{order.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell}</td><td className="p-2">{orderTypeLabel(order.type)}</td><td className="p-2">{number(order.quantity, 8)}</td><td className="p-2">{order.filledPrice ?? order.price ?? "—"}</td><td className="p-2">{orderStatusLabel(order.status)}</td></tr>)}</tbody></table></div>;
}

function FillHistory({ snapshot }: { snapshot: PaperSessionSnapshot }) {
  if (!snapshot.recentFills.length) return <p className="text-sm text-slate-500">{copy.paperTrading.noFills}</p>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="p-2">{copy.paperTrading.time}</th><th className="p-2">{copy.paperTrading.side}</th><th className="p-2">{copy.paperTrading.quantity}</th><th className="p-2">{copy.paperTrading.price}</th><th className="p-2">{copy.paperTrading.reason}</th><th className="p-2">{copy.paperTrading.pnl}</th></tr></thead><tbody>{snapshot.recentFills.map((fill) => <tr key={fill.id} className="border-b"><td className="p-2">{new Date(fill.timestamp).toLocaleString("zh-CN")}</td><td className="p-2">{fill.side === "BUY" ? copy.paperTrading.buy : copy.paperTrading.sell}</td><td className="p-2">{number(fill.quantity, 8)}</td><td className="p-2">{number(fill.price, 8)}</td><td className="p-2">{fillReasonLabel(fill.reason)}</td><td className="p-2">{number(fill.realizedPnl)}</td></tr>)}</tbody></table></div>;
}

function Stats({ snapshot }: { snapshot: PaperSessionSnapshot }) {
  const stats = snapshot.stats;
  const values = [[copy.paperTrading.tradeCount, stats.tradeCount], [copy.paperTrading.winRate, `${number(stats.winRate * 100)}%`], [copy.paperTrading.profitFactor, stats.profitFactor == null ? "∞" : number(stats.profitFactor)], [copy.paperTrading.averageWin, number(stats.averageWin)], [copy.paperTrading.averageLoss, number(stats.averageLoss)], [copy.paperTrading.maxWins, stats.maxConsecutiveWins], [copy.paperTrading.maxLosses, stats.maxConsecutiveLosses], [copy.paperTrading.totalSlippage, number(stats.totalSlippage)]];
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{values.map(([label, value]) => <div key={String(label)} className="rounded-md border bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-950">{value}</p></div>)}</div><EquityCurve datasetId={snapshot.session.datasetId} /></div>;
}

function EquityCurve({ datasetId }: { datasetId: string }) {
  const [points, setPoints] = useState<Array<{ sequence: number; equity: number }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market-datasets/${datasetId}/paper-session/history?type=equity`)
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setPoints(data.items ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [datasetId]);
  if (!points.length) return null;
  return <div className="h-64 rounded-md border p-3"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><XAxis dataKey="sequence" tick={{ fontSize: 11 }} /><YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={70} /><Tooltip /><Line type="monotone" dataKey="equity" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}
