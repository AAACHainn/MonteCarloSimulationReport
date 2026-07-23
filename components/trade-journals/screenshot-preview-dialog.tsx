"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ExternalLink, Tag, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/i18n";
import type { TradeTagValue } from "@/lib/trade-journal/tags";

export function ScreenshotPreviewDialog({
  screenshotUrl,
  tags = [],
  onClose,
}: {
  screenshotUrl: string | null;
  tags?: TradeTagValue[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!screenshotUrl) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, screenshotUrl]);

  if (!screenshotUrl || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={copy.tradeJournals.previewScreenshot}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="relative flex max-h-[92vh] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex w-full flex-col gap-3 border-b border-slate-700 bg-slate-900 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Tag className="h-4 w-4" />
              {copy.tradeJournals.tags.currentTradeTags}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <Badge key={tag.id} className="border-blue-400/40 bg-blue-500/15 text-blue-100">
                    {tag.name}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-slate-400">{copy.tradeJournals.tags.none}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={screenshotUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white shadow hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ExternalLink className="h-4 w-4" />
              {copy.tradeJournals.openOriginalScreenshot}
            </a>
            <button
              type="button"
              className="rounded-md bg-slate-800 p-2 text-white shadow hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              onClick={onClose}
              aria-label={copy.tradeJournals.closePreview}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 items-center justify-center p-3">
          <Image
            src={screenshotUrl}
            alt={copy.tradeJournals.previewScreenshot}
            width={1600}
            height={1200}
            unoptimized
            className="max-h-[78vh] w-auto max-w-[90vw] object-contain"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
