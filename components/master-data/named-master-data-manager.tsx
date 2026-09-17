"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/i18n";

export type ManagedNamedMasterData = { id: string; name: string; usageCount: number };

type ManagerText = {
  title: string; description: string; name: string; placeholder: string; create: string; empty: string;
  usageCount: string; edit: string; editName: string; save: string; delete: string; deleteInUse: string;
  deleteTitle: string; deleteConfirm: string; saveError: string; deleteError: string;
};

export function NamedMasterDataManager({
  items, endpoint, inputId, maxNameLength, text, icon,
}: {
  items: ManagedNamedMasterData[];
  endpoint: string;
  inputId: string;
  maxNameLength: number;
  text: ManagerText;
  icon: ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteItem, setDeleteItem] = useState<ManagedNamedMasterData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setIsSaving(true);
    setError(null);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formData.get("name") }),
    });
    const data = await response.json().catch(() => null);
    setIsSaving(false);
    if (!response.ok) {
      setError(getApiError(data, text.saveError));
      return;
    }
    form.reset();
    router.refresh();
  }

  async function saveItem(itemId: string) {
    setIsSaving(true);
    setError(null);
    const response = await fetch(`${endpoint}/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName }),
    });
    const data = await response.json().catch(() => null);
    setIsSaving(false);
    if (!response.ok) {
      setError(getApiError(data, text.saveError));
      return;
    }
    setEditingId(null);
    setEditName("");
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleteItem) return;
    setIsDeleting(true);
    setError(null);
    const response = await fetch(`${endpoint}/${deleteItem.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => null);
    setIsDeleting(false);
    if (!response.ok) {
      setError(getApiError(data, text.deleteError));
      setDeleteItem(null);
      return;
    }
    setDeleteItem(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{icon}{text.title}</CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={createItem} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor={inputId}>{text.name}</Label>
            <Input id={inputId} name="name" required maxLength={maxNameLength} placeholder={text.placeholder} />
          </div>
          <Button type="submit" disabled={isSaving}>
            <Plus className="h-4 w-4" aria-hidden="true" />{text.create}
          </Button>
        </form>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}

        {items.length === 0 ? (
          <p className="rounded-md border border-dashed p-5 text-center text-sm text-slate-500">{text.empty}</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg border bg-slate-50 p-3">
                {editingId === item.id ? <>
                  <Input value={editName} maxLength={maxNameLength} onChange={(event) => setEditName(event.target.value)} className="h-8 min-w-0 flex-1" aria-label={text.editName} />
                  <Button type="button" size="sm" className="h-8 w-8 px-0" onClick={() => void saveItem(item.id)} disabled={isSaving} aria-label={text.save}><Check className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 px-0" onClick={() => { setEditingId(null); setEditName(""); }} disabled={isSaving} aria-label={copy.common.cancel}><X className="h-4 w-4" aria-hidden="true" /></Button>
                </> : <>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-950" title={item.name}>{item.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{text.usageCount.replace("{count}", String(item.usageCount))}</div>
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 px-0" onClick={() => { setEditingId(item.id); setEditName(item.name); setError(null); }} disabled={editingId !== null} aria-label={text.edit}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 px-0" onClick={() => setDeleteItem(item)} disabled={editingId !== null || item.usageCount > 0} aria-label={text.delete} title={item.usageCount > 0 ? text.deleteInUse : text.delete}><Trash2 className="h-4 w-4 text-red-600" aria-hidden="true" /></Button>
                </>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <ConfirmDialog open={Boolean(deleteItem)} title={text.deleteTitle} description={deleteItem ? text.deleteConfirm.replace("{name}", deleteItem.name) : ""} confirmLabel={text.delete} isLoading={isDeleting} onCancel={() => setDeleteItem(null)} onConfirm={confirmDelete} />
    </Card>
  );
}

function getApiError(data: unknown, fallback: string) {
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
