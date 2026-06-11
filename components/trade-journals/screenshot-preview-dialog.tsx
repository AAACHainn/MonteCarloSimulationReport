"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ExternalLink, X } from "lucide-react";
import { copy } from "@/lib/i18n";

export function ScreenshotPreviewDialog({
  screenshotUrl,
  onClose,
}: {
  screenshotUrl: string | null;
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
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] max-w-[94vw] items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-950 p-3 shadow-2xl"
      >
        <Image
          src={screenshotUrl}
          alt={copy.tradeJournals.previewScreenshot}
          width={1600}
          height={1200}
          unoptimized
          className="max-h-[86vh] w-auto max-w-[90vw] object-contain"
          onClick={(event) => event.stopPropagation()}
        />
        <a
          href={screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-md bg-slate-950/80 px-3 py-2 text-sm font-medium text-white shadow hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-4 w-4" />
          {copy.tradeJournals.openOriginalScreenshot}
        </a>
        <button
          type="button"
          className="absolute right-4 top-4 rounded-md bg-slate-950/80 p-2 text-white shadow hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={onClose}
          aria-label={copy.tradeJournals.closePreview}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
