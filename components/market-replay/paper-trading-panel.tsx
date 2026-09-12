"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, GripHorizontal, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PaperJournalTable } from "@/components/market-replay/paper-journal-table";
import { copy } from "@/lib/i18n";
import { snapPriceToTick } from "@/lib/market-replay/price-ticks";
import type { MarketBarData } from "@/lib/market-replay/types";
import type { PaperOrderData, PaperOrderType, PaperSessionSnapshot, PaperSide, ReplayJournalEntryData } from "@/lib/paper-trading/types";

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

type PanelSize = { width: number; height: number };
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const PANEL_MARGIN = 8;
const PANEL_MIN_WIDTH = 560;
const PANEL_MIN_HEIGHT = 320;
const RESIZE_HANDLES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: "n", className: "-top-1 left-3 right-3 h-2 cursor-n-resize" },
  { direction: "ne", className: "-right-1 -top-1 h-4 w-4 cursor-ne-resize" },
  { direction: "e", className: "-right-1 bottom-3 top-3 w-2 cursor-e-resize" },
  { direction: "se", className: "-bottom-1 -right-1 h-4 w-4 cursor-se-resize" },
  { direction: "s", className: "-bottom-1 left-3 right-3 h-2 cursor-s-resize" },
  { direction: "sw", className: "-bottom-1 -left-1 h-4 w-4 cursor-sw-resize" },
  { direction: "w", className: "-left-1 bottom-3 top-3 w-2 cursor-w-resize" },
  { direction: "nw", className: "-left-1 -top-1 h-4 w-4 cursor-nw-resize" },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

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

export function PaperTradingDetails({ snapshot, onFocusJournalEntry }: { snapshot: PaperSessionSnapshot | null; onFocusJournalEntry?: (entry: ReplayJournalEntryData) => void }) {
  const [tab, setTab] = useState<"orders" | "fills" | "journal" | "stats">("orders");
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<PanelSize | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    direction: ResizeDirection;
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const keepInViewport = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const maxWidth = Math.max(1, window.innerWidth - PANEL_MARGIN * 2);
      const maxHeight = Math.max(1, window.innerHeight - PANEL_MARGIN * 2);
      const width = clamp(rect.width, Math.min(PANEL_MIN_WIDTH, maxWidth), maxWidth);
      const height = clamp(rect.height, Math.min(PANEL_MIN_HEIGHT, maxHeight), maxHeight);
      setSize({ width, height });
      setPosition((current) => {
        const x = current?.x ?? rect.left;
        const y = current?.y ?? rect.top;
        return {
          x: clamp(x, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN)),
          y: clamp(y, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN)),
        };
      });
    };
    const frame = requestAnimationFrame(keepInViewport);
    window.addEventListener("resize", keepInViewport);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", keepInViewport);
    };
  }, [open]);

  const startResize = (direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    resizeRef.current = {
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const resizePanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const minimumWidth = Math.min(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN * 2);
    const minimumHeight = Math.min(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_MARGIN * 2);
    const deltaX = event.clientX - resize.startX;
    const deltaY = event.clientY - resize.startY;
    let left = resize.left;
    let top = resize.top;
    let width = resize.width;
    let height = resize.height;

    if (resize.direction.includes("e")) {
      width = clamp(resize.width + deltaX, minimumWidth, window.innerWidth - PANEL_MARGIN - resize.left);
    }
    if (resize.direction.includes("s")) {
      height = clamp(resize.height + deltaY, minimumHeight, window.innerHeight - PANEL_MARGIN - resize.top);
    }
    if (resize.direction.includes("w")) {
      const right = resize.left + resize.width;
      left = clamp(resize.left + deltaX, PANEL_MARGIN, right - minimumWidth);
      width = right - left;
    }
    if (resize.direction.includes("n")) {
      const bottom = resize.top + resize.height;
      top = clamp(resize.top + deltaY, PANEL_MARGIN, bottom - minimumHeight);
      height = bottom - top;
    }

    setPosition({ x: left, y: top });
    setSize({ width, height });
  };

  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!snapshot) return null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        {copy.paperTrading.records}
      </Button>
      {open ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={copy.paperTrading.records}
          className="fixed z-[100] h-[min(44rem,calc(100vh-1rem))] w-[min(80rem,calc(100vw-1rem))]"
          style={position && size
            ? { left: position.x, top: position.y, width: size.width, height: size.height }
            : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        >
          <Card className="h-full overflow-hidden border-slate-300 bg-white shadow-2xl"><CardContent className="flex h-full flex-col p-0">
            <div
              className="flex h-12 shrink-0 touch-none select-none items-center gap-2 border-b bg-slate-50 px-3 cursor-move"
              title={copy.paperTrading.dragRecords}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
                const rect = panelRef.current?.getBoundingClientRect();
                if (!rect) return;
                dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                const panel = panelRef.current;
                if (!drag || drag.pointerId !== event.pointerId || !panel) return;
                const rect = panel.getBoundingClientRect();
                setPosition({
                  x: Math.min(Math.max(8, event.clientX - drag.offsetX), Math.max(8, window.innerWidth - rect.width - 8)),
                  y: Math.min(Math.max(8, event.clientY - drag.offsetY), Math.max(8, window.innerHeight - rect.height - 8)),
                });
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId !== event.pointerId) return;
                dragRef.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              <GripHorizontal className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span className="mr-1 text-sm font-semibold text-slate-800">{copy.paperTrading.records}</span>
              <Button size="sm" variant={tab === "orders" ? "default" : "ghost"} onClick={() => setTab("orders")}>{copy.paperTrading.ordersTab}</Button>
              <Button size="sm" variant={tab === "fills" ? "default" : "ghost"} onClick={() => setTab("fills")}>{copy.paperTrading.fillsTab}</Button>
              <Button size="sm" variant={tab === "journal" ? "default" : "ghost"} onClick={() => setTab("journal")}>{copy.paperTrading.journalTab}</Button>
              <Button size="sm" variant={tab === "stats" ? "default" : "ghost"} onClick={() => setTab("stats")}>{copy.paperTrading.statsTab}</Button>
              <Button type="button" variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={() => setOpen(false)} aria-label={copy.paperTrading.closeRecords}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {tab === "orders" ? <OrderHistory snapshot={snapshot} /> : tab === "fills" ? <FillHistory snapshot={snapshot} /> : tab === "journal" ? <PaperJournalTable datasetId={snapshot.session.datasetId} scope="current" onFocus={(entry) => { setOpen(false); onFocusJournalEntry?.(entry); }} /> : <Stats snapshot={snapshot} />}
            </div>
          </CardContent></Card>
          {RESIZE_HANDLES.map(({ direction, className }) => (
            <div
              key={direction}
              className={`absolute z-10 touch-none select-none ${className}`}
              title={copy.paperTrading.resizeRecords}
              onPointerDown={(event) => startResize(direction, event)}
              onPointerMove={resizePanel}
              onPointerUp={stopResize}
              onPointerCancel={stopResize}
            />
          ))}
          <div className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-slate-400/60" aria-hidden="true" />
        </div>,
        document.body,
      ) : null}
    </>
  );
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
