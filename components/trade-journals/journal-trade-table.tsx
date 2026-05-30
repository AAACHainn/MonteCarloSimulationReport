"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { ScreenshotPreviewDialog } from "@/components/trade-journals/screenshot-preview-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";
import { copy } from "@/lib/i18n";

type TradeOption = {
  id: string;
  type: "INSTRUMENT" | "STRATEGY";
  name: string;
  active: boolean;
};

export type JournalTradeRow = {
  id: string;
  date: string;
  direction: string | null;
  riskAmount: number | null;
  rMultiple: number;
  instrumentOptionId: string | null;
  strategyOptionId: string | null;
  instrumentOption: { name: string } | null;
  strategyOption: { name: string } | null;
  entryPrice: number | null;
  stopLossPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  screenshotPath: string | null;
};

type Draft = {
  date: string;
  instrumentOptionId: string;
  strategyOptionId: string;
  entryPrice: string;
  stopLossPrice: string;
  riskAmount: string;
  targetPrice: string;
  exitPrice: string;
  screenshot: File | null;
};

const emptyDraft: Draft = {
  date: "",
  instrumentOptionId: "",
  strategyOptionId: "",
  entryPrice: "",
  stopLossPrice: "",
  riskAmount: "",
  targetPrice: "",
  exitPrice: "",
  screenshot: null,
};

export function JournalTradeTable({
  journalId,
  trades,
  options,
}: {
  journalId: string;
  trades: JournalTradeRow[];
  options: TradeOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(trades);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTradeId, setDeleteTradeId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewScreenshot, setPreviewScreenshot] = useState<string | null>(null);
  const instruments = options.filter((option) => option.type === "INSTRUMENT");
  const strategies = options.filter((option) => option.type === "STRATEGY");

  useEffect(() => setRows(trades), [trades]);

  function beginCreate() {
    setDraft(emptyDraft);
    setEditingId("new");
    setError(null);
  }

  function beginEdit(trade: JournalTradeRow) {
    setDraft({
      date: trade.date,
      instrumentOptionId: trade.instrumentOptionId ?? "",
      strategyOptionId: trade.strategyOptionId ?? "",
      entryPrice: trade.entryPrice === null ? "" : String(trade.entryPrice),
      stopLossPrice: trade.stopLossPrice === null ? "" : String(trade.stopLossPrice),
      riskAmount: trade.riskAmount === null ? "" : String(trade.riskAmount),
      targetPrice: trade.targetPrice === null ? "" : String(trade.targetPrice),
      exitPrice: trade.exitPrice === null ? "" : String(trade.exitPrice),
      screenshot: null,
    });
    setEditingId(trade.id);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft);
    setError(null);
  }

  async function saveTrade() {
    setError(null);
    if (editingId === "new" && !draft.screenshot) {
      setError(copy.tradeJournals.screenshotRequired);
      return;
    }

    const formData = new FormData();
    for (const [key, value] of Object.entries(draft)) {
      if (value !== null) formData.set(key, value);
    }

    setIsSaving(true);
    const isNew = editingId === "new";
    const response = await fetch(
      isNew ? `/api/trade-journals/${journalId}/trades` : `/api/trade-journals/${journalId}/trades/${editingId}`,
      { method: isNew ? "POST" : "PUT", body: formData },
    );
    const data = await response.json();
    setIsSaving(false);
    if (!response.ok) {
      setError(data.error ?? copy.tradeJournals.saveError);
      return;
    }

    const row = serializeApiTrade(data);
    setRows((current) => isNew ? [...current, row] : current.map((trade) => trade.id === row.id ? row : trade));
    cancelEdit();
    router.refresh();
  }

  async function deleteTrade() {
    if (!deleteTradeId) return;
    setIsDeleting(true);
    const response = await fetch(`/api/trade-journals/${journalId}/trades/${deleteTradeId}`, { method: "DELETE" });
    setIsDeleting(false);
    if (response.ok) {
      setRows((current) => current.filter((trade) => trade.id !== deleteTradeId));
      setDeleteTradeId(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{copy.tradeJournals.detailDescription}</p>
        <Button
          type="button"
          size="sm"
          onClick={beginCreate}
          disabled={editingId !== null || !instruments.some((option) => option.active) || !strategies.some((option) => option.active)}
        >
          <Plus className="h-4 w-4" />
          {copy.tradeJournals.addTrade}
        </Button>
      </div>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <Table className={editingId ? "min-w-[1480px] [&_td]:px-2 [&_th]:px-2" : "table-fixed [&_td]:px-2 [&_th]:px-2"}>
        <TableHeader>
          <TableRow>
            <TableHead>{copy.tradeJournals.table.date}</TableHead>
            <TableHead>{copy.tradeJournals.table.instrument}</TableHead>
            <TableHead>{copy.tradeJournals.table.strategy}</TableHead>
            <TableHead>{copy.tradeJournals.table.direction}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.entry}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.stop}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.risk}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.target}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.exit}</TableHead>
            <TableHead className="text-right">{copy.tradeJournals.table.r}</TableHead>
            <TableHead>{copy.tradeJournals.table.screenshot}</TableHead>
            <TableHead>{copy.tradeJournals.table.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {editingId === "new" ? <EditableRow draft={draft} setDraft={setDraft} options={options} onSave={saveTrade} onCancel={cancelEdit} loading={isSaving} /> : null}
          {rows.map((trade) =>
            editingId === trade.id ? (
              <EditableRow key={trade.id} draft={draft} setDraft={setDraft} options={options} onSave={saveTrade} onCancel={cancelEdit} loading={isSaving} />
            ) : (
              <TableRow key={trade.id}>
                <TableCell className="whitespace-nowrap">{trade.date}</TableCell>
                <TableCell className="truncate" title={trade.instrumentOption?.name ?? undefined}>{trade.instrumentOption?.name ?? copy.common.dash}</TableCell>
                <TableCell className="truncate" title={trade.strategyOption?.name ?? undefined}>{trade.strategyOption?.name ?? copy.common.dash}</TableCell>
                <TableCell className="whitespace-nowrap">{trade.direction === "LONG" ? copy.tradeJournals.table.long : copy.tradeJournals.table.short}</TableCell>
                <PriceCell value={trade.entryPrice} />
                <PriceCell value={trade.stopLossPrice} />
                <TableCell className="text-right">{trade.riskAmount === null ? copy.common.dash : formatMoney(trade.riskAmount)}</TableCell>
                <PriceCell value={trade.targetPrice} />
                <PriceCell value={trade.exitPrice} />
                <TableCell className="text-right font-mono">{formatNumber(trade.rMultiple)}</TableCell>
                <TableCell>
                  {trade.screenshotPath ? (
                    <button
                      type="button"
                      className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setPreviewScreenshot(`/api/trade-journals/${journalId}/trades/${trade.id}/screenshot`)}
                      aria-label={copy.tradeJournals.previewScreenshot}
                    >
                      <Image
                        src={`/api/trade-journals/${journalId}/trades/${trade.id}/screenshot`}
                        alt={copy.tradeJournals.table.screenshot}
                        width={72}
                        height={44}
                        unoptimized
                        className="h-11 w-[72px] rounded border object-cover"
                      />
                    </button>
                  ) : copy.common.dash}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 px-0"
                      onClick={() => beginEdit(trade)}
                      disabled={editingId !== null}
                      aria-label={copy.tradeJournals.edit}
                      title={copy.tradeJournals.edit}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 px-0"
                      onClick={() => setDeleteTradeId(trade.id)}
                      disabled={editingId !== null}
                      aria-label={copy.tradeJournals.deleteTrade}
                      title={copy.tradeJournals.deleteTrade}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      {rows.length === 0 && editingId !== "new" ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">{copy.datasets.noTrades}</p>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTradeId)}
        title={copy.tradeJournals.deleteTradeTitle}
        description={copy.tradeJournals.deleteTradeConfirm}
        confirmLabel={copy.tradeJournals.deleteTrade}
        isLoading={isDeleting}
        onCancel={() => setDeleteTradeId(null)}
        onConfirm={deleteTrade}
      />
      <ScreenshotPreviewDialog screenshotUrl={previewScreenshot} onClose={() => setPreviewScreenshot(null)} />
    </div>
  );
}

function EditableRow({
  draft,
  setDraft,
  options,
  onSave,
  onCancel,
  loading,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  options: TradeOption[];
  onSave: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  function setField<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <TableRow className="bg-blue-50/50 align-top">
      <TableCell><DatePicker value={draft.date} onChange={(value) => setField("date", value)} /></TableCell>
      <TableCell><OptionSelect value={draft.instrumentOptionId} onChange={(value) => setField("instrumentOptionId", value)} options={options.filter((option) => option.type === "INSTRUMENT")} placeholder={copy.tradeJournals.chooseInstrument} /></TableCell>
      <TableCell><OptionSelect value={draft.strategyOptionId} onChange={(value) => setField("strategyOptionId", value)} options={options.filter((option) => option.type === "STRATEGY")} placeholder={copy.tradeJournals.chooseStrategy} /></TableCell>
      <TableCell className="text-slate-400">{copy.common.dash}</TableCell>
      <NumberInput value={draft.entryPrice} onChange={(value) => setField("entryPrice", value)} />
      <NumberInput value={draft.stopLossPrice} onChange={(value) => setField("stopLossPrice", value)} />
      <NumberInput value={draft.riskAmount} onChange={(value) => setField("riskAmount", value)} />
      <NumberInput value={draft.targetPrice} onChange={(value) => setField("targetPrice", value)} />
      <NumberInput value={draft.exitPrice} onChange={(value) => setField("exitPrice", value)} />
      <TableCell className="text-right text-slate-400">{copy.common.dash}</TableCell>
      <TableCell><Input type="file" accept="image/jpeg,image/png,image/webp" className="w-56" onChange={(event) => setField("screenshot", event.target.files?.[0] ?? null)} /></TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button type="button" size="sm" onClick={onSave} disabled={loading}><Check className="h-4 w-4" />{copy.tradeJournals.save}</Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={loading}><X className="h-4 w-4" />{copy.tradeJournals.cancel}</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function OptionSelect({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: TradeOption[]; placeholder: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} disabled={!option.active && option.id !== value}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <TableCell><Input type="number" min="0.00000001" step="any" value={value} onChange={(event) => onChange(event.target.value)} className="w-28 text-right" /></TableCell>;
}

function PriceCell({ value }: { value: number | null }) {
  return <TableCell className="text-right font-mono">{value === null ? copy.common.dash : formatNumber(value)}</TableCell>;
}

function serializeApiTrade(trade: JournalTradeRow & { date: string }) {
  return { ...trade, date: trade.date.slice(0, 10) };
}
