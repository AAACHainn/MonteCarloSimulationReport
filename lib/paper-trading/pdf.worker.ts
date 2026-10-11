import { ReplayPdfDocument } from "./pdf-document";
import { copy } from "@/lib/i18n";
import type { PdfWorkerRequest, PdfWorkerResponse } from "./pdf-types";

const worker = self as unknown as { onmessage: ((event: MessageEvent<PdfWorkerRequest>) => void) | null; postMessage: (data: PdfWorkerResponse, transfer?: Transferable[]) => void };
let document: ReplayPdfDocument | null = null;
worker.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.type === "init") document = new ReplayPdfDocument(request.metadata, request.font);
    else if (request.type === "chart") {
      if (!document) throw new Error(copy.paperTrading.pdf.failed);
      document.addChart(request.page, request.png, request.caption);
    } else {
      if (!document) throw new Error(copy.paperTrading.pdf.failed);
      const pdf = document.finish(); document = null;
      worker.postMessage({ id: request.id, pdf }, [pdf]); return;
    }
    worker.postMessage({ id: request.id });
  } catch (error) {
    worker.postMessage({ id: request.id, error: error instanceof Error ? error.message : copy.paperTrading.pdf.failed });
  }
};
