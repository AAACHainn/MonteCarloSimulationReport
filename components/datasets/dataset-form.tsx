"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/lib/i18n";

export function DatasetForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    const formData = new FormData(form);
    const response = await fetch("/api/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        description: formData.get("description"),
      }),
    });

    if (!response.ok) {
      setError(copy.datasets.createError);
      return;
    }

    form.reset();
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{copy.datasets.name}</Label>
        <Input id="name" name="name" placeholder={copy.datasets.namePlaceholder} required maxLength={120} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">{copy.datasets.description}</Label>
        <Textarea id="description" name="description" placeholder={copy.datasets.descriptionPlaceholder} />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" disabled={isPending}>
        <Plus className="h-4 w-4" />
        {copy.datasets.create}
      </Button>
    </form>
  );
}
