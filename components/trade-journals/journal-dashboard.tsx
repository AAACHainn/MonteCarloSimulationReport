"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Download, NotebookTabs, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/lib/i18n";

type Journal = {
  id: string;
  name: string;
  description: string | null;
  dataset: { _count: { trades: number; simulationRuns: number } };
};

type TradeOption = {
  id: string;
  type: "INSTRUMENT" | "STRATEGY";
  name: string;
  active: boolean;
};

export function JournalDashboard({ journals, options }: { journals: Journal[]; options: TradeOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function createJournal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setCreateError(null);
    const response = await fetch("/api/trade-journals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formData.get("name"), description: formData.get("description") }),
    });
    if (!response.ok) {
      setCreateError(copy.tradeJournals.createError);
      return;
    }
    form.reset();
    startTransition(() => router.refresh());
  }

  async function importBackup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setImportError(null);
    const response = await fetch("/api/trade-journals/import", { method: "POST", body: new FormData(form) });
    const data = await response.json();
    if (!response.ok) {
      setImportError(data.error ?? copy.tradeJournals.importError);
      return;
    }
    form.reset();
    router.push(`/trade-journals/${data.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{copy.tradeJournals.createTitle}</CardTitle>
            <CardDescription>{copy.tradeJournals.createDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createJournal} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="journal-name">{copy.tradeJournals.name}</Label>
                <Input id="journal-name" name="name" required maxLength={120} placeholder={copy.tradeJournals.namePlaceholder} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="journal-description">{copy.tradeJournals.description}</Label>
                <Textarea id="journal-description" name="description" placeholder={copy.tradeJournals.descriptionPlaceholder} />
              </div>
              {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
              <Button type="submit" disabled={isPending}>
                <Plus className="h-4 w-4" />
                {copy.tradeJournals.create}
              </Button>
            </form>
          </CardContent>
        </Card>

        <OptionManager options={options} />

        <Card>
          <CardHeader>
            <CardTitle>{copy.tradeJournals.backupTitle}</CardTitle>
            <CardDescription>{copy.tradeJournals.backupDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={importBackup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="zip-file">{copy.tradeJournals.zipFile}</Label>
                <Input id="zip-file" name="file" type="file" accept=".zip,application/zip" required />
              </div>
              {importError ? <p className="text-sm text-red-600">{importError}</p> : null}
              <Button type="submit" variant="outline">
                <ArchiveRestore className="h-4 w-4" />
                {copy.tradeJournals.import}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{copy.tradeJournals.title}</h2>
          <p className="text-sm text-slate-600">{copy.tradeJournals.subtitle}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {journals.length === 0 ? (
            <p className="rounded-lg border bg-white p-6 text-sm text-slate-600">{copy.tradeJournals.empty}</p>
          ) : (
            journals.map((journal) => (
              <Card key={journal.id}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start gap-3">
                    <NotebookTabs className="mt-1 h-5 w-5 text-blue-700" />
                    <div>
                      <h3 className="font-semibold text-slate-950">{journal.name}</h3>
                      <p className="text-sm text-slate-600">{journal.description || copy.datasets.noDescription}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {journal.dataset._count.trades} {copy.tradeJournals.trades} · {journal.dataset._count.simulationRuns}{" "}
                        {copy.tradeJournals.simulations}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild size="sm" className="flex-1">
                      <Link href={`/trade-journals/${journal.id}`}>{copy.home.open}</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <a href={`/api/trade-journals/${journal.id}/export`}>
                        <Download className="h-4 w-4" />
                        {copy.tradeJournals.export}
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function OptionManager({ options }: { options: TradeOption[] }) {
  const router = useRouter();
  const [type, setType] = useState<TradeOption["type"]>("INSTRUMENT");
  const [error, setError] = useState<string | null>(null);

  async function addOption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    const response = await fetch("/api/trade-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name: formData.get("name") }),
    });
    if (!response.ok) {
      setError("无法保存选项。");
      return;
    }
    form.reset();
    router.refresh();
  }

  async function changeOption(option: TradeOption) {
    const response = option.active
      ? await fetch(`/api/trade-options/${option.id}`, { method: "DELETE" })
      : await fetch(`/api/trade-options/${option.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: true }),
        });
    if (response.ok) router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.tradeJournals.optionsTitle}</CardTitle>
        <CardDescription>{copy.tradeJournals.optionsDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          {(["INSTRUMENT", "STRATEGY"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={type === value ? "default" : "outline"}
              onClick={() => setType(value)}
            >
              {value === "INSTRUMENT" ? copy.tradeJournals.instrument : copy.tradeJournals.strategy}
            </Button>
          ))}
        </div>
        <form onSubmit={addOption} className="flex gap-2">
          <Input name="name" required maxLength={80} placeholder={copy.tradeJournals.optionPlaceholder} />
          <Button type="submit" size="sm">{copy.tradeJournals.addOption}</Button>
        </form>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="max-h-44 space-y-2 overflow-auto">
          {options.filter((option) => option.type === type).length === 0 ? (
            <p className="text-sm text-slate-500">{copy.tradeJournals.noOptions}</p>
          ) : (
            options.filter((option) => option.type === type).map((option) => (
              <div key={option.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span className={option.active ? "text-slate-900" : "text-slate-400"}>{option.name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => changeOption(option)}>
                  {option.active ? copy.tradeJournals.deactivate : copy.tradeJournals.reactivate}
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
