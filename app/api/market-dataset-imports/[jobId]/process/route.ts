import { NextResponse } from "next/server";
import { copy } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { startMarketImportWorker } from "@/lib/market-replay/import-worker";

export const runtime = "nodejs";
export const maxDuration = 3_600;
type RouteContext = { params: Promise<{ jobId: string }> };
export async function POST(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  try {
    const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
    if (!job?.storedPath || !["UPLOADED", "FAILED", "INTERRUPTED"].includes(job.status)) {
      return NextResponse.json({ error: copy.marketReplay.importAlreadyRunning }, { status: 409 });
    }
    const claimed = await prisma.marketDatasetImport.updateMany({
      where: { id: jobId, status: { in: ["UPLOADED", "FAILED", "INTERRUPTED"] } },
      data: {
        status: "QUEUED", stage: job.datasetId ? "CLEANING" : "ANALYZING",
        stageProcessedBytes: 0, stageTotalBytes: job.compressedBytes, stageStartedAt: new Date(),
        processedRows: 0, importedBars: 0, totalRows: 0, totalErrors: 0, errors: "[]", workerPid: null,
      },
    });
    if (claimed.count !== 1) return NextResponse.json({ error: copy.marketReplay.importAlreadyRunning }, { status: 409 });
    const workerPid = startMarketImportWorker(jobId);
    await prisma.marketDatasetImport.updateMany({
      where: { id: jobId, status: { in: ["QUEUED", "PROCESSING"] } }, data: { workerPid },
    });
    return NextResponse.json({ accepted: true, jobId }, { status: 202 });
  } catch (error) {
    await prisma.marketDatasetImport.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: {
        status: "FAILED", workerPid: null,
        errors: JSON.stringify([{ row: 1, reason: error instanceof Error ? error.message : copy.marketReplay.importError }]),
        totalErrors: 1,
      },
    }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : copy.marketReplay.importError }, { status: 500 });
  }
}
