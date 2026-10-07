"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/lib/i18n";
import { limitReview, reviewLength, type ReviewTemplate } from "@/lib/paper-trading/review-templates";
import { reviewTemplateRenameSchema, reviewTemplateSchema } from "@/lib/validations";

export function ReviewEditorDialog({ open, no, value, saving, error, onChange, onSave, onClose }: {
  open: boolean;
  no: number;
  value: string;
  saving: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const templatesAbortRef = useRef<AbortController | null>(null);
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [name, setName] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [renamingTemplate, setRenamingTemplate] = useState<ReviewTemplate | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<ReviewTemplate | null>(null);
  const [templateDeleting, setTemplateDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId);
  const managementBusy = saving || templateSaving || templateDeleting;

  const loadTemplates = useCallback(async () => {
    templatesAbortRef.current?.abort();
    const controller = new AbortController();
    templatesAbortRef.current = controller;
    const signal = controller.signal;
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const response = await fetch("/api/replay-review-templates", { signal });
      const data: unknown = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error(copy.paperTrading.reviewTemplatesLoadFailed);
      if (!signal.aborted) {
        const items = data as ReviewTemplate[];
        setTemplates(items);
        setSelectedTemplateId((current) => items.some((item) => item.id === current) ? current : "");
      }
    } catch {
      if (!signal.aborted) setTemplatesError(copy.paperTrading.reviewTemplatesLoadFailed);
    } finally {
      if (!signal.aborted) setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedTemplateId("");
    setStatus(null);
    setNameOpen(false);
    setRenamingTemplate(null);
    setDeletingTemplate(null);
    setDeleteError(null);
    void loadTemplates();
    return () => templatesAbortRef.current?.abort();
  }, [open, no, loadTemplates]);

  function chooseTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setSelectedTemplateId(id);
    setStatus(null);
    onChange(template.content);
  }

  function openNameDialog() {
    setRenamingTemplate(null);
    setName("");
    setTemplateError(null);
    setNameOpen(true);
  }

  function openRenameDialog() {
    if (!selectedTemplate || managementBusy) return;
    setRenamingTemplate(selectedTemplate);
    setName(selectedTemplate.name);
    setTemplateError(null);
    setNameOpen(true);
  }

  async function deleteTemplate() {
    if (!deletingTemplate || templateDeleting) return;
    setTemplateDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/replay-review-templates/${deletingTemplate.id}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok && response.status !== 404) throw new Error(data.error ?? copy.paperTrading.reviewTemplateDeleteFailed);
      templatesAbortRef.current?.abort();
      setTemplatesLoading(false);
      setTemplatesError(null);
      setTemplates((current) => current.filter((item) => item.id !== deletingTemplate.id));
      setSelectedTemplateId((current) => current === deletingTemplate.id ? "" : current);
      setDeletingTemplate(null);
      setStatus(copy.paperTrading.reviewTemplateDeleted);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : copy.paperTrading.reviewTemplateDeleteFailed);
      setDeletingTemplate(null);
    } finally {
      setTemplateDeleting(false);
    }
  }

  async function saveTemplate() {
    if (templateSaving) return;
    const parsed = renamingTemplate
      ? reviewTemplateRenameSchema.safeParse({ name })
      : reviewTemplateSchema.safeParse({ name, content: value });
    if (!parsed.success) {
      setTemplateError(parsed.error.issues[0]?.message ?? copy.paperTrading.reviewTemplateSaveFailed);
      return;
    }
    setTemplateSaving(true);
    setTemplateError(null);
    try {
      const response = await fetch(renamingTemplate ? `/api/replay-review-templates/${renamingTemplate.id}` : "/api/replay-review-templates", {
        method: renamingTemplate ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const data = await response.json() as ReviewTemplate & { error?: string };
      if (!response.ok) throw new Error(data.error ?? (renamingTemplate ? copy.paperTrading.reviewTemplateRenameFailed : copy.paperTrading.reviewTemplateSaveFailed));
      templatesAbortRef.current?.abort();
      setTemplatesLoading(false);
      setTemplatesError(null);
      setTemplates((current) => [...current.filter((item) => item.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
      setSelectedTemplateId(data.id);
      setStatus(renamingTemplate ? copy.paperTrading.reviewTemplateRenamed : copy.paperTrading.reviewTemplateSaved);
      setNameOpen(false);
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : copy.paperTrading.reviewTemplateSaveFailed);
    } finally {
      setTemplateSaving(false);
    }
  }

  return <>
    <Dialog open={open} title={copy.paperTrading.reviewDialogTitle(no)} description={copy.paperTrading.reviewDialogDescription}
      onClose={() => { if (!managementBusy && !nameOpen && !deletingTemplate) onClose(); }}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!managementBusy && !nameOpen && !deletingTemplate) onSave(); }}>
        <div className="space-y-2">
          <Label htmlFor="replay-review-template">{copy.paperTrading.reviewTemplate}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
          <Select value={selectedTemplateId} onValueChange={chooseTemplate} disabled={saving || templatesLoading || templates.length === 0}>
            <SelectTrigger id="replay-review-template" className="min-w-0 overflow-hidden text-left [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:truncate" aria-busy={templatesLoading} aria-describedby="replay-review-template-hint">
              <SelectValue placeholder={templatesLoading ? copy.paperTrading.reviewTemplatesLoading : copy.paperTrading.chooseReviewTemplate} />
            </SelectTrigger>
            <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
              {templates.map((template) => <SelectItem key={template.id} value={template.id} className="whitespace-normal break-words">{template.name}</SelectItem>)}
            </SelectContent>
          </Select>
            </div>
            <div className="flex shrink-0 justify-end gap-2">
              <Button type="button" variant="outline" onClick={openRenameDialog} disabled={!selectedTemplate || managementBusy || templatesLoading}><Pencil className="h-4 w-4" aria-hidden="true" />{copy.paperTrading.renameReviewTemplate}</Button>
              <Button type="button" variant="destructive" onClick={() => { if (selectedTemplate) { setDeleteError(null); setDeletingTemplate(selectedTemplate); } }} disabled={!selectedTemplate || managementBusy || templatesLoading}><Trash2 className="h-4 w-4" aria-hidden="true" />{copy.paperTrading.deleteReviewTemplate}</Button>
            </div>
          </div>
          {deleteError ? <p className="text-xs text-red-600" role="alert">{deleteError}</p> : null}
          <p id="replay-review-template-hint" className="text-xs text-slate-500">{!templatesLoading && !templatesError && templates.length === 0 ? copy.paperTrading.noReviewTemplates : copy.paperTrading.reviewTemplateHint}</p>
          {templatesError ? <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-red-600" role="alert">{templatesError}</p><Button type="button" variant="ghost" size="sm" onClick={() => void loadTemplates()} disabled={templatesLoading}>{copy.paperTrading.retryReviewTemplates}</Button></div> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="replay-journal-review">{copy.paperTrading.review}</Label>
          <Textarea id="replay-journal-review" value={value} onChange={(event) => { onChange(limitReview(event.target.value)); setStatus(null); }}
            placeholder={copy.paperTrading.reviewPlaceholder} className="min-h-64 resize-y" disabled={saving} aria-describedby="replay-journal-review-count replay-journal-review-error" autoFocus />
          <div className="flex items-start justify-between gap-3">
            {error ? <p id="replay-journal-review-error" className="text-xs text-red-600" role="alert">{error}</p> : <span />}
            <p id="replay-journal-review-count" className="shrink-0 text-xs text-slate-500">{copy.paperTrading.reviewCharacterCount(reviewLength(value))}</p>
          </div>
        </div>
        {status ? <p className="text-xs text-emerald-700" role="status" aria-live="polite">{status}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={openNameDialog} disabled={saving || !value.trim()}>{copy.paperTrading.saveReviewTemplate}</Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>{copy.common.cancel}</Button>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{copy.paperTrading.saveReview}</Button>
        </div>
      </form>
    </Dialog>
    <Dialog open={open && nameOpen} title={renamingTemplate ? copy.paperTrading.renameReviewTemplateTitle : copy.paperTrading.reviewTemplateDialogTitle} description={renamingTemplate ? copy.paperTrading.renameReviewTemplateDescription : copy.paperTrading.reviewTemplateDialogDescription}
      className="max-w-md" onClose={() => { if (!templateSaving) setNameOpen(false); }}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveTemplate(); }} aria-busy={templateSaving}>
        <div className="space-y-2">
          <Label htmlFor="replay-review-template-name">{copy.paperTrading.reviewTemplateName}</Label>
          <Input id="replay-review-template-name" value={name} onChange={(event) => { setName(event.target.value); setTemplateError(null); }}
            placeholder={copy.paperTrading.reviewTemplateNamePlaceholder} disabled={templateSaving} autoFocus aria-invalid={Boolean(templateError)} aria-describedby={templateError ? "replay-review-template-name-error" : undefined} />
          {templateError ? <p id="replay-review-template-name-error" className="text-xs text-red-600" role="alert">{templateError}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => setNameOpen(false)} disabled={templateSaving}>{copy.common.cancel}</Button>
          <Button type="submit" disabled={templateSaving || !name.trim()}>{templateSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{renamingTemplate ? copy.paperTrading.saveReviewTemplateName : copy.paperTrading.saveReviewTemplate}</Button>
        </div>
      </form>
    </Dialog>
    <ConfirmDialog
      open={open && deletingTemplate !== null}
      title={copy.paperTrading.deleteReviewTemplateTitle}
      description={copy.paperTrading.deleteReviewTemplateConfirm(deletingTemplate?.name ?? "")}
      confirmLabel={copy.paperTrading.deleteReviewTemplate}
      isLoading={templateDeleting}
      onCancel={() => { if (!templateDeleting) setDeletingTemplate(null); }}
      onConfirm={() => void deleteTemplate()}
    />
  </>;
}
