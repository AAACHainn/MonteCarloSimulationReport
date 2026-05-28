"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";

export function DeleteDatasetButton({ datasetId }: { datasetId: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function onDelete() {
    if (!window.confirm(copy.datasets.deleteConfirm)) return;
    setIsDeleting(true);
    const response = await fetch(`/api/datasets/${datasetId}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/datasets");
      router.refresh();
      return;
    }
    setIsDeleting(false);
  }

  return (
    <Button type="button" variant="destructive" onClick={onDelete} disabled={isDeleting}>
      <Trash2 className="h-4 w-4" />
      {copy.datasets.delete}
    </Button>
  );
}
