"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";

type ImportResult = {
  importedCount: number;
  skippedDuplicateCount: number;
};

export function MergeJournalImport({ journalId }: { journalId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importBackup(file: File | null) {
    if (!file) return;

    const formData = new FormData();
    formData.set("file", file);
    setIsImporting(true);
    setMessage(null);
    setError(null);

    const response = await fetch(`/api/trade-journals/${journalId}/import`, { method: "POST", body: formData });
    const data = await response.json().catch(() => null);
    setIsImporting(false);
    if (inputRef.current) inputRef.current.value = "";

    if (!response.ok) {
      setError(data?.error ?? copy.tradeJournals.mergeImportError);
      return;
    }

    const result = data as ImportResult;
    setMessage(copy.tradeJournals.mergeImportResult(result.importedCount, result.skippedDuplicateCount));
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => importBackup(event.target.files?.[0] ?? null)}
      />
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isImporting}>
        <ArchiveRestore className="h-4 w-4" />
        {copy.tradeJournals.mergeImport}
      </Button>
      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
