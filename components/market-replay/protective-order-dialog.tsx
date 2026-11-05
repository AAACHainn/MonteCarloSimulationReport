"use client";

import { useId, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatQuantity } from "@/lib/format";
import { snapPriceToTick, isPriceOnTick } from "@/lib/market-replay/price-ticks";
import { defaultPartialExitQuantity, isValidProtectivePrice, protectiveOrderLabel, protectiveQuantityMode, type ProtectiveQuantityMode } from "@/lib/paper-trading/protective-orders";
import type { PaperOrderData } from "@/lib/paper-trading/types";
import type { OrderUpdate } from "./replay-chart-shared";

type Props = {
  order: PaperOrderData;
  creating: boolean;
  netQuantity: number;
  currentPrice: number;
  priceTickSize: number;
  busy: boolean;
  error: string | null;
  available: boolean;
  onSave: (update: OrderUpdate) => Promise<boolean>;
  onAdd: () => void;
  onClose: () => void;
};

export function ProtectiveOrderDialog({ order, creating, netQuantity, currentPrice, priceTickSize, busy, error, available, onSave, onAdd, onClose }: Props) {
  const id = useId();
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [price, setPrice] = useState(String(order.price ?? currentPrice));
  const [quantity, setQuantity] = useState(String(creating ? defaultPartialExitQuantity(netQuantity) : order.quantity));
  const [mode, setMode] = useState<ProtectiveQuantityMode>(creating ? "FIXED" : protectiveQuantityMode(order));
  const [localError, setLocalError] = useState<string | null>(null);
  const maximum = Math.abs(netQuantity);
  const locked = busy || saving;
  const effectiveQuantity = mode === "ALL" ? maximum : Number(quantity);
  const close = () => { if (!submitting.current && !busy) onClose(); };
  const title = creating ? copy.paperTrading.createPartialExit : copy.paperTrading.exitSettings(protectiveOrderLabel(order));

  async function save() {
    if (submitting.current || locked || !available) return;
    setLocalError(null);
    const nextPrice = Number(price);
    if (!isValidProtectivePrice(netQuantity, order.type, nextPrice, currentPrice)) {
      setLocalError(copy.paperTrading.invalidBracket); return;
    }
    if (!isPriceOnTick(nextPrice, priceTickSize)) { setLocalError(copy.paperTrading.priceNotOnTick); return; }
    if (!Number.isFinite(effectiveQuantity) || effectiveQuantity <= 1e-12 || effectiveQuantity > maximum) {
      setLocalError(copy.paperTrading.exitQuantityExceeded); return;
    }
    submitting.current = true; setSaving(true);
    try {
      if (await onSave({ price: snapPriceToTick(nextPrice, priceTickSize), quantity: effectiveQuantity, quantityMode: mode })) onClose();
      else setLocalError(copy.paperTrading.requestFailed);
    } catch { setLocalError(copy.paperTrading.requestFailed); }
    finally { submitting.current = false; setSaving(false); }
  }

  return <Dialog open title={title} description={copy.paperTrading.exitSettingsHint} className="max-w-md" onClose={close}>
    <form noValidate className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p className="flex justify-between gap-3 text-sm tabular-nums"><span>{copy.paperTrading.exitCurrentPosition}</span><strong>{formatQuantity(maximum)}</strong></p>
      <fieldset disabled={locked || !available} className="space-y-4">
        <div className="space-y-2"><Label htmlFor={id + "-price"}>{copy.paperTrading.orderPrice}</Label>
          <Input id={id + "-price"} type="number" min={priceTickSize} step={priceTickSize} value={price} onChange={(event) => setPrice(event.target.value)} aria-describedby={id + "-error"} /></div>
        <div className="space-y-2"><Label htmlFor={id + "-mode"}>{copy.paperTrading.exitQuantityMode}</Label>
          <Select value={mode} onValueChange={(value: ProtectiveQuantityMode) => setMode(value)} disabled={creating || locked || !available}>
            <SelectTrigger id={id + "-mode"}><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="ALL">{copy.paperTrading.exitAllRemaining}</SelectItem><SelectItem value="FIXED">{copy.paperTrading.exitFixedQuantity}</SelectItem>
            </SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor={id + "-quantity"}>{copy.paperTrading.quantity}</Label>
          <Input id={id + "-quantity"} type="number" step="any" min="0" max={maximum} value={mode === "ALL" ? String(maximum) : quantity} disabled={mode === "ALL"} onChange={(event) => setQuantity(event.target.value)} aria-describedby={id + "-error"} />
          <div className="flex gap-2">{[25, 50, 100].map((percent) => <Button key={percent} type="button" variant="outline" size="sm" onClick={() => { setMode("FIXED"); setQuantity(String(maximum * percent / 100)); }}>{percent}%</Button>)}</div>
          <p className="text-xs text-slate-600 dark:text-secondary-text">{mode === "ALL" ? copy.paperTrading.exitAllHint : copy.paperTrading.exitFixedHint}</p>
        </div>
      </fieldset>
      <p id={id + "-error"} role="alert" className="text-sm text-red-700 dark:text-negative">{!available ? copy.paperTrading.exitOrderUnavailable : localError ?? error}</p>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        {!creating ? <Button type="button" variant="outline" disabled={locked || !available} onClick={onAdd}><Plus className="h-4 w-4" aria-hidden="true" />{copy.paperTrading.addPartialExit}</Button> : null}
        <Button type="button" variant="outline" disabled={locked} onClick={close}>{copy.common.cancel}</Button>
        <Button type="submit" disabled={locked || !available}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{copy.paperTrading.save}</Button>
      </div>
    </form>
  </Dialog>;
}
