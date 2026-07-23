"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";
import { MAX_TAG_NAME_LENGTH } from "@/lib/trade-journal/tags";

export type ManagedTradeTag = {
  id: string;
  name: string;
  _count: { trades: number };
};

export function TradeTagManager({ tags }: { tags: ManagedTradeTag[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTag, setDeleteTag] = useState<ManagedTradeTag | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function createTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setIsSaving(true);
    setError(null);
    const response = await fetch("/api/trade-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formData.get("name") }),
    });
    const data = await response.json().catch(() => null);
    setIsSaving(false);

    if (!response.ok) {
      setError(getTagApiError(data, copy.tradeJournals.tags.managerSaveError));
      return;
    }

    form.reset();
    router.refresh();
  }

  function beginEdit(tag: ManagedTradeTag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setError(null);
  }

  async function saveTag(tagId: string) {
    setIsSaving(true);
    setError(null);
    const response = await fetch(`/api/trade-tags/${tagId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName }),
    });
    const data = await response.json().catch(() => null);
    setIsSaving(false);

    if (!response.ok) {
      setError(getTagApiError(data, copy.tradeJournals.tags.managerSaveError));
      return;
    }

    setEditingId(null);
    setEditName("");
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleteTag) return;
    setIsDeleting(true);
    setError(null);
    const response = await fetch(`/api/trade-tags/${deleteTag.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    setIsDeleting(false);

    if (!response.ok) {
      setError(getTagApiError(data, copy.tradeJournals.tags.managerDeleteError));
      setDeleteTag(null);
      return;
    }

    setDeleteTag(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="h-5 w-5 text-blue-700" />
          {copy.tradeJournals.tags.managerTitle}
        </CardTitle>
        <CardDescription>{copy.tradeJournals.tags.managerDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={createTag} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="new-trade-tag">{copy.tradeJournals.tags.name}</Label>
            <Input
              id="new-trade-tag"
              name="name"
              required
              maxLength={MAX_TAG_NAME_LENGTH}
              placeholder={copy.tradeJournals.tags.managerPlaceholder}
            />
          </div>
          <Button type="submit" disabled={isSaving}>
            <Plus className="h-4 w-4" />
            {copy.tradeJournals.tags.create}
          </Button>
        </form>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        {tags.length === 0 ? (
          <p className="rounded-md border border-dashed p-5 text-center text-sm text-slate-500">
            {copy.tradeJournals.tags.managerEmpty}
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {tags.map((tag) => (
              <div key={tag.id} className="flex min-w-0 items-center gap-2 rounded-lg border bg-slate-50 p-3">
                {editingId === tag.id ? (
                  <>
                    <Input
                      value={editName}
                      maxLength={MAX_TAG_NAME_LENGTH}
                      onChange={(event) => setEditName(event.target.value)}
                      className="h-8 min-w-0 flex-1"
                      aria-label={copy.tradeJournals.tags.editName}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 w-8 px-0"
                      onClick={() => void saveTag(tag.id)}
                      disabled={isSaving}
                      aria-label={copy.tradeJournals.tags.save}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 px-0"
                      onClick={() => {
                        setEditingId(null);
                        setEditName("");
                      }}
                      disabled={isSaving}
                      aria-label={copy.common.cancel}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-950" title={tag.name}>{tag.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {copy.tradeJournals.tags.usageCount.replace("{count}", String(tag._count.trades))}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 px-0"
                      onClick={() => beginEdit(tag)}
                      disabled={editingId !== null}
                      aria-label={copy.tradeJournals.tags.edit}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 px-0"
                      onClick={() => setDeleteTag(tag)}
                      disabled={editingId !== null || tag._count.trades > 0}
                      aria-label={copy.tradeJournals.tags.delete}
                      title={tag._count.trades > 0 ? copy.tradeJournals.tags.deleteInUse : copy.tradeJournals.tags.delete}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={Boolean(deleteTag)}
        title={copy.tradeJournals.tags.deleteTitle}
        description={deleteTag ? copy.tradeJournals.tags.deleteConfirm.replace("{name}", deleteTag.name) : ""}
        confirmLabel={copy.tradeJournals.tags.delete}
        isLoading={isDeleting}
        onCancel={() => setDeleteTag(null)}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}

function getTagApiError(data: unknown, fallback: string) {
  if (!data || typeof data !== "object" || !("error" in data)) return fallback;
  const error = data.error;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;
  const fieldErrors = "fieldErrors" in error ? error.fieldErrors : null;
  if (fieldErrors && typeof fieldErrors === "object") {
    const firstError = Object.values(fieldErrors).flat().find((value) => typeof value === "string");
    if (typeof firstError === "string") return firstError;
  }
  return fallback;
}
