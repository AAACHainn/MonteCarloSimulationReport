"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { copy } from "@/lib/i18n";

export function DeleteJournalButton({
  journalId,
  size = "sm",
  className,
}: {
  journalId: string;
  size?: ButtonProps["size"];
  className?: ButtonProps["className"];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    setLoading(true);
    const response = await fetch(`/api/trade-journals/${journalId}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/trade-journals");
      router.refresh();
      return;
    }
    setLoading(false);
  }

  return (
    <>
      <Button type="button" variant="destructive" size={size} className={className} onClick={() => setOpen(true)} disabled={loading}>
        <Trash2 className="h-4 w-4" />
        {copy.tradeJournals.delete}
      </Button>
      <ConfirmDialog
        open={open}
        title={copy.tradeJournals.deleteDialogTitle}
        description={copy.tradeJournals.deleteConfirm}
        confirmLabel={copy.tradeJournals.delete}
        isLoading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={onDelete}
      />
    </>
  );
}
