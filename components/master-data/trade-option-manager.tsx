"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/i18n";

export type ManagedTradeOption = {
  id: string;
  type: "INSTRUMENT" | "STRATEGY";
  name: string;
  active: boolean;
};

export function TradeOptionManager({
  type,
  options,
}: {
  type: ManagedTradeOption["type"];
  options: ManagedTradeOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteOption, setDeleteOption] = useState<ManagedTradeOption | null>(null);
  const [isSavingOption, setIsSavingOption] = useState(false);
  const [isDeletingOption, setIsDeletingOption] = useState(false);
  const text = type === "INSTRUMENT" ? copy.masterData.options.instruments : copy.masterData.options.strategies;

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
      setError(data?.error ?? copy.masterData.options.saveError);
      return;
    }
    form.reset();
    router.refresh();
  }

  function beginEditOption(option: ManagedTradeOption) {
    setEditingOptionId(option.id);
    setEditName(option.name);
    setError(null);
  }

  function cancelEditOption() {
    setEditingOptionId(null);
    setEditName("");
    setError(null);
  }

  async function saveOption(option: ManagedTradeOption) {
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
      setError(data?.error ?? copy.masterData.options.saveError);
      return;
    }

    cancelEditOption();
    router.refresh();
  }

  async function toggleOptionActive(option: ManagedTradeOption) {
    setError(null);
    const response = await fetch(`/api/trade-options/${option.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !option.active }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setError(data?.error ?? copy.masterData.options.saveError);
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
      setError(data?.error ?? copy.masterData.options.deleteError);
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
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>{text.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addOption} className="flex gap-2">
            <Input name="name" required maxLength={80} placeholder={text.placeholder} />
            <Button type="submit" size="sm">{copy.masterData.options.add}</Button>
          </form>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {visibleOptions.length === 0 ? (
              <p className="text-sm text-slate-500">{text.empty}</p>
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
                          aria-label={copy.masterData.options.save}
                          title={copy.masterData.options.save}
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
                          aria-label={copy.masterData.options.edit}
                          title={copy.masterData.options.edit}
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
                          {option.active ? copy.masterData.options.deactivate : copy.masterData.options.reactivate}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleteOption(option)}
                          aria-label={copy.masterData.options.delete}
                          title={copy.masterData.options.delete}
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
        title={copy.masterData.options.deleteTitle}
        description={copy.masterData.options.deleteConfirm}
        confirmLabel={copy.masterData.options.delete}
        isLoading={isDeletingOption}
        onCancel={() => setDeleteOption(null)}
        onConfirm={confirmDeleteOption}
      />
    </>
  );
}
