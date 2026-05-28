"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { copy } from "@/lib/i18n";

export function DeleteSimulationRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  async function onDelete() {
    setIsDeleting(true);
    const response = await fetch(`/api/simulations/${runId}`, { method: "DELETE" });
    if (response.ok) {
      setIsConfirmOpen(false);
      router.refresh();
      return;
    }
    setIsDeleting(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setIsConfirmOpen(true)}
        disabled={isDeleting}
      >
        <Trash2 className="h-4 w-4" />
        {copy.simulations.delete}
      </Button>
      <ConfirmDialog
        open={isConfirmOpen}
        title={copy.simulations.deleteDialogTitle}
        description={copy.simulations.deleteConfirm}
        confirmLabel={copy.simulations.delete}
        isLoading={isDeleting}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={onDelete}
      />
    </>
  );
}
