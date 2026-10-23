"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copy } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";
import { defaultRiskAmount, riskPreferencesSchema, type RiskPreferences } from "@/lib/paper-trading/risk-preferences";

export function RiskDefaultsDialog({ preferences, balance, currency, onClose, onSave }: {
  preferences: RiskPreferences; balance: number; currency: string; onClose: () => void;
  onSave: (preferences: RiskPreferences) => Promise<void>;
}) {
  const id = useId();
  const [mode, setMode] = useState(preferences.riskMode);
  const [amount, setAmount] = useState(String(preferences.riskAmount));
  const [percent, setPercent] = useState(String(preferences.riskPercent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = copy.paperTrading;
  const configured = { ...preferences, riskMode: mode,
    riskAmount: mode === "FIXED" ? Number(amount) : preferences.riskAmount,
    riskPercent: mode === "BALANCE_PERCENT" ? Number(percent) : preferences.riskPercent };
  const parsed = riskPreferencesSchema.safeParse(configured);
  return <Dialog open title={t.riskDefaultsTitle} description={t.riskDefaultsDescription} className="max-w-md" onClose={() => { if (!busy) onClose(); }}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      if (!parsed.success) { setError(t.riskDefaultsInvalid); return; }
      setBusy(true); setError(null);
      try { await onSave(configured); }
      catch (reason) { setError(reason instanceof Error ? reason.message : copy.replaySessions.requestFailed); }
      finally { setBusy(false); }
    }}>
      <div className="space-y-2"><Label htmlFor={`${id}-mode`}>{t.riskDefaultsMode}</Label>
        <Select value={mode} disabled={busy} onValueChange={value => { setMode(value as RiskPreferences["riskMode"]); setError(null); }}>
          <SelectTrigger id={`${id}-mode`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="FIXED">{t.riskDefaultsFixed}</SelectItem><SelectItem value="BALANCE_PERCENT">{t.riskDefaultsPercent}</SelectItem></SelectContent>
        </Select>
      </div>
      {mode === "FIXED" ? <div className="space-y-2"><Label htmlFor={`${id}-amount`}>{t.fixedRiskAmount} · {currency}</Label><Input id={`${id}-amount`} type="number" min="0.01" step="any" required disabled={busy} value={amount} onChange={event => { setAmount(event.target.value); setError(null); }} /></div>
        : <div className="space-y-2"><Label htmlFor={`${id}-percent`}>{t.riskDefaultsPercentLabel}</Label><Input id={`${id}-percent`} type="number" min="0.000001" max="100" step="any" required disabled={busy} value={percent} onChange={event => { setPercent(event.target.value); setError(null); }} /><p className="text-xs text-slate-500">{t.riskDefaultsPercentHint}</p></div>}
      <p className="text-sm tabular-nums text-slate-600">{t.riskDefaultsBalance}: {formatMoney(balance, currency)} · {t.riskDefaultsPreview}: {parsed.success ? formatMoney(defaultRiskAmount(configured, balance), currency) : copy.common.dash}</p>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{copy.common.cancel}</Button><Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t.riskDefaultsSave}</Button></div>
    </form>
  </Dialog>;
}
