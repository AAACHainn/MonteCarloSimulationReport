"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";

type UploadResult = {
  imported: number;
  rejectedRows: Array<{ row: number; reason: string }>;
};

export function TradeUpload({ datasetId }: { datasetId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [rejections, setRejections] = useState<UploadResult["rejectedRows"]>([]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(null);
    setRejections([]);
    const formData = new FormData(form);
    const response = await fetch(`/api/datasets/${datasetId}/trades/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? copy.datasets.uploadFailed);
      setRejections(data.rejectedRows ?? []);
      return;
    }

    setMessage(copy.datasets.importedTrades(data.imported));
    setRejections(data.rejectedRows ?? []);
    form.reset();
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="file">{copy.datasets.csvFile}</Label>
        <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <Button type="submit" disabled={isPending}>
        <Upload className="h-4 w-4" />
        {copy.datasets.uploadTrades}
      </Button>
      {message ? (
        <Alert>
          <AlertTitle>{message}</AlertTitle>
          {rejections.length > 0 ? (
            <AlertDescription>
              {rejections.slice(0, 5).map((row) => (
                <div key={`${row.row}-${row.reason}`}>
                  {copy.datasets.rejectedRow(row.row, row.reason)}
                </div>
              ))}
              {rejections.length > 5 ? <div>{copy.datasets.moreRejected(rejections.length - 5)}</div> : null}
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}
    </form>
  );
}
