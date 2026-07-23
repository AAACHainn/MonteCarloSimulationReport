"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArchiveRestore,
  Check,
  CheckCircle2,
  CircleAlert,
  Download,
  FileArchive,
  Loader2,
  NotebookTabs,
  Pencil,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { DeleteJournalButton } from "@/components/trade-journals/delete-journal-button";
import { TradeTagManager, type ManagedTradeTag } from "@/components/trade-journals/trade-tag-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

type ImportStatus = "idle" | "uploading" | "processing" | "success" | "error";

type ImportedJournal = {
  id: string;
  name: string;
};

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function JournalDashboard({
  journals,
  options,
  tags,
}: {
  journals: Journal[];
  options: TradeOption[];
  tags: ManagedTradeTag[];
}) {
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [importedJournal, setImportedJournal] = useState<ImportedJournal | null>(null);
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

  function selectBackup(file: File | null) {
    setImportedJournal(null);
    setImportError(null);
    setUploadProgress(0);

    if (!file) {
      setSelectedBackup(null);
      setImportStatus("idle");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      setSelectedBackup(null);
      setImportStatus("error");
      setImportError(copy.tradeJournals.invalidZipFile);
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }

    setSelectedBackup(file);
    setImportStatus("idle");
  }

  function importBackup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBackup) {
      setImportStatus("error");
      setImportError(copy.tradeJournals.invalidZipFile);
      return;
    }

    const formData = new FormData();
    formData.set("file", selectedBackup);
    setImportError(null);
    setImportedJournal(null);
    setUploadProgress(0);
    setImportStatus("uploading");

    const request = new XMLHttpRequest();
    request.open("POST", "/api/trade-journals/import");
    request.responseType = "json";

    request.upload.addEventListener("progress", (progressEvent) => {
      if (!progressEvent.lengthComputable) return;
      setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
    });
    request.upload.addEventListener("load", () => {
      setUploadProgress(100);
      setImportStatus("processing");
    });
    request.addEventListener("load", () => {
      const data = request.response as (ImportedJournal & { error?: string }) | null;

      if (request.status < 200 || request.status >= 300) {
        setImportStatus("error");
        setImportError(data?.error ?? copy.tradeJournals.importError);
        return;
      }

      if (!data?.id || !data.name) {
        setImportStatus("error");
        setImportError(copy.tradeJournals.importError);
        return;
      }

      setImportStatus("success");
      setImportedJournal({ id: data.id, name: data.name });
      setSelectedBackup(null);
      if (importInputRef.current) importInputRef.current.value = "";
      startTransition(() => router.refresh());
    });
    request.addEventListener("error", () => {
      setImportStatus("error");
      setImportError(copy.tradeJournals.importNetworkError);
    });
    request.send(formData);
  }

  const importInProgress = importStatus === "uploading" || importStatus === "processing";
  const overallProgress =
    importStatus === "uploading" ? Math.max(5, Math.round(uploadProgress * 0.7)) : importStatus === "processing" ? 85 : 100;

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
              <input
                ref={importInputRef}
                id="zip-file"
                name="file"
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                onChange={(event) => selectBackup(event.target.files?.[0] ?? null)}
                disabled={importInProgress}
              />
              <Label htmlFor="zip-file" className="sr-only">
                {copy.tradeJournals.zipFile}
              </Label>
              <button
                type="button"
                className="flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-blue-400 hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => importInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!importInProgress) selectBackup(event.dataTransfer.files?.[0] ?? null);
                }}
                disabled={importInProgress}
              >
                {selectedBackup ? (
                  <>
                    <FileArchive className="mb-2 h-8 w-8 text-blue-700" />
                    <span className="font-medium text-slate-950">{copy.tradeJournals.zipFileSelected}</span>
                    <span className="mt-1 max-w-full break-all text-sm text-slate-700">{selectedBackup.name}</span>
                    <span className="mt-1 text-xs text-slate-500">
                      {formatFileSize(selectedBackup.size)} · {copy.tradeJournals.replaceZipFile}
                    </span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="mb-2 h-8 w-8 text-blue-700" />
                    <span className="font-medium text-slate-950">{copy.tradeJournals.chooseZipFile}</span>
                    <span className="mt-1 text-sm text-slate-600">{copy.tradeJournals.dropZipFile}</span>
                    <span className="mt-1 text-xs text-slate-500">{copy.tradeJournals.zipFileHint}</span>
                  </>
                )}
              </button>

              {importInProgress ? (
                <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3" role="status" aria-live="polite">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 font-medium text-blue-900">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      {importStatus === "uploading"
                        ? copy.tradeJournals.uploadingBackup(uploadProgress)
                        : copy.tradeJournals.processingBackup}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-blue-700">{overallProgress}%</span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-blue-100"
                    role="progressbar"
                    aria-label={copy.tradeJournals.importing}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={overallProgress}
                  >
                    <div
                      className={`h-full rounded-full bg-blue-600 transition-[width] duration-300 ${
                        importStatus === "processing" ? "animate-pulse" : ""
                      }`}
                      style={{ width: `${overallProgress}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {importStatus === "success" && importedJournal ? (
                <Alert className="border-emerald-200 bg-emerald-50" role="status" aria-live="polite">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                    <div className="min-w-0 flex-1">
                      <AlertTitle className="text-emerald-950">{copy.tradeJournals.importSuccessTitle}</AlertTitle>
                      <AlertDescription className="text-emerald-800">
                        {copy.tradeJournals.importSuccess(importedJournal.name)}
                      </AlertDescription>
                      <Button asChild size="sm" className="mt-3">
                        <Link href={`/trade-journals/${importedJournal.id}`}>{copy.tradeJournals.openImportedJournal}</Link>
                      </Button>
                    </div>
                  </div>
                </Alert>
              ) : null}

              {importStatus === "error" && importError ? (
                <Alert className="border-red-200 bg-red-50" role="alert">
                  <div className="flex items-start gap-3">
                    <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
                    <div>
                      <AlertTitle className="text-red-950">{copy.tradeJournals.importFailedTitle}</AlertTitle>
                      <AlertDescription className="text-red-700">{importError}</AlertDescription>
                    </div>
                  </div>
                </Alert>
              ) : null}

              <Button type="submit" className="w-full" disabled={!selectedBackup || importInProgress}>
                {importInProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
                {importInProgress ? copy.tradeJournals.importing : copy.tradeJournals.import}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <TradeTagManager tags={tags} />

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{copy.tradeJournals.title}</h2>
          <p className="text-sm text-slate-600">{copy.tradeJournals.subtitle}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {journals.length === 0 ? (
            <p className="rounded-lg border bg-white p-6 text-sm text-slate-600">{copy.tradeJournals.empty}</p>
          ) : (
            journals.map((journal) => <JournalCard key={journal.id} journal={journal} />)
          )}
        </div>
      </section>
    </div>
  );
}

function JournalCard({ journal }: { journal: Journal }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(journal.name);
  const [description, setDescription] = useState(journal.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function beginEdit() {
    setName(journal.name);
    setDescription(journal.description ?? "");
    setError(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setName(journal.name);
    setDescription(journal.description ?? "");
    setError(null);
    setIsEditing(false);
  }

  async function saveJournal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(copy.api.journalNameRequired);
      return;
    }

    setIsSaving(true);
    setError(null);
    const response = await fetch(`/api/trade-journals/${journal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmedName, description }),
    });
    const data = await response.json().catch(() => null);
    setIsSaving(false);

    if (!response.ok) {
      const message =
        typeof data?.error === "string"
          ? data.error
          : data?.error?.fieldErrors?.name?.[0] ?? data?.error?.formErrors?.[0] ?? copy.tradeJournals.updateError;
      setError(message);
      return;
    }

    setIsEditing(false);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        {isEditing ? (
          <form onSubmit={saveJournal} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`journal-name-${journal.id}`}>{copy.tradeJournals.name}</Label>
              <Input
                id={`journal-name-${journal.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`journal-description-${journal.id}`}>{copy.tradeJournals.description}</Label>
              <Textarea
                id={`journal-description-${journal.id}`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                className="min-h-20"
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={isSaving}>
                <X className="h-4 w-4" />
                {copy.common.cancel}
              </Button>
              <Button type="submit" size="sm" disabled={isSaving}>
                <Check className="h-4 w-4" />
                {copy.tradeJournals.saveJournal}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <NotebookTabs className="mt-1 h-5 w-5 shrink-0 text-blue-700" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold text-slate-950">{journal.name}</h3>
                <p className="text-sm text-slate-600">{journal.description || copy.datasets.noDescription}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {journal.dataset._count.trades} {copy.tradeJournals.trades} · {journal.dataset._count.simulationRuns}{" "}
                  {copy.tradeJournals.simulations}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild size="sm" className="w-full">
                <Link href={`/trade-journals/${journal.id}`}>{copy.home.open}</Link>
              </Button>
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={beginEdit}>
                <Pencil className="h-4 w-4" />
                {copy.tradeJournals.editJournal}
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={`/api/trade-journals/${journal.id}/export`}>
                  <Download className="h-4 w-4" />
                  {copy.tradeJournals.export}
                </a>
              </Button>
              <DeleteJournalButton journalId={journal.id} className="w-full" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OptionManager({ options }: { options: TradeOption[] }) {
  const router = useRouter();
  const [type, setType] = useState<TradeOption["type"]>("INSTRUMENT");
  const [error, setError] = useState<string | null>(null);
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteOption, setDeleteOption] = useState<TradeOption | null>(null);
  const [isSavingOption, setIsSavingOption] = useState(false);
  const [isDeletingOption, setIsDeletingOption] = useState(false);

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
      const data = await response.json().catch(() => null);
      setError(data?.error ?? copy.tradeJournals.optionSaveError);
      return;
    }
    form.reset();
    router.refresh();
  }

  function beginEditOption(option: TradeOption) {
    setEditingOptionId(option.id);
    setEditName(option.name);
    setError(null);
  }

  function cancelEditOption() {
    setEditingOptionId(null);
    setEditName("");
    setError(null);
  }

  async function saveOption(option: TradeOption) {
    const name = editName.trim();
    if (!name) {
      setError(copy.api.optionNameRequired);
      return;
    }

    setIsSavingOption(true);
    setError(null);
    const response = await fetch(`/api/trade-options/${option.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await response.json().catch(() => null);
    setIsSavingOption(false);

    if (!response.ok) {
      setError(data?.error ?? copy.tradeJournals.optionSaveError);
      return;
    }

    cancelEditOption();
    router.refresh();
  }

  async function toggleOptionActive(option: TradeOption) {
    setError(null);
    const response = await fetch(`/api/trade-options/${option.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !option.active }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setError(data?.error ?? copy.tradeJournals.optionSaveError);
      return;
    }

    router.refresh();
  }

  async function confirmDeleteOption() {
    if (!deleteOption) return;

    setIsDeletingOption(true);
    setError(null);
    const response = await fetch(`/api/trade-options/${deleteOption.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    setIsDeletingOption(false);

    if (!response.ok) {
      setError(data?.error ?? copy.tradeJournals.optionDeleteError);
      return;
    }

    if (editingOptionId === deleteOption.id) {
      cancelEditOption();
    }
    setDeleteOption(null);
    router.refresh();
  }

  const visibleOptions = options.filter((option) => option.type === type);

  return (
    <>
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
          <div className="max-h-44 space-y-2 overflow-auto pr-1">
            {visibleOptions.length === 0 ? (
              <p className="text-sm text-slate-500">{copy.tradeJournals.noOptions}</p>
            ) : (
              visibleOptions.map((option) => {
                const isEditing = editingOptionId === option.id;

                return (
                  <div key={option.id} className="flex min-h-12 items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    {isEditing ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          maxLength={80}
                          className="h-8 min-w-0 flex-1"
                          autoFocus
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                          onClick={() => saveOption(option)}
                          disabled={isSavingOption}
                          aria-label={copy.tradeJournals.saveOption}
                          title={copy.tradeJournals.saveOption}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={cancelEditOption}
                          disabled={isSavingOption}
                          aria-label={copy.common.cancel}
                          title={copy.common.cancel}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className={`min-w-0 flex-1 truncate ${option.active ? "text-slate-900" : "text-slate-400"}`}>
                          {option.name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => beginEditOption(option)}
                          aria-label={copy.tradeJournals.editOption}
                          title={copy.tradeJournals.editOption}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 shrink-0 px-2"
                          onClick={() => toggleOptionActive(option)}
                        >
                          {option.active ? copy.tradeJournals.deactivate : copy.tradeJournals.reactivate}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleteOption(option)}
                          aria-label={copy.tradeJournals.deleteOption}
                          title={copy.tradeJournals.deleteOption}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={Boolean(deleteOption)}
        title={copy.tradeJournals.deleteOptionTitle}
        description={copy.tradeJournals.deleteOptionConfirm}
        confirmLabel={copy.tradeJournals.deleteOption}
        isLoading={isDeletingOption}
        onCancel={() => setDeleteOption(null)}
        onConfirm={confirmDeleteOption}
      />
    </>
  );
}
