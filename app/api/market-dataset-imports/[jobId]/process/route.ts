import { NextResponse } from "next/server";
import { copy } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { startMarketImportWorker } from "@/lib/market-replay/import-worker";

export const runtime = "nodejs";
export const maxDuration = 3_600;
type RouteContext = { params: Promise<{ jobId: string }> };
export async function POST(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  try {
    const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
    const input = await request.json().catch(() => null) as { confirmGaps?: boolean } | null;
    const confirming = job?.status === "AWAITING_CONFIRMATION";
    if (!job?.storedPath || (!confirming && !["UPLOADED", "FAILED", "INTERRUPTED"].includes(job.status))) {
      return NextResponse.json({ error: copy.marketReplay.importAlreadyRunning }, { status: 409 });
    }
    if (confirming && input?.confirmGaps !== true) {
      return NextResponse.json({ error: copy.marketReplay.appendGapDescription }, { status: 409 });
    }
    const metadata = confirming ? { ...JSON.parse(job.metadata), confirmed: true } : null;
    const claimed = await prisma.marketDatasetImport.updateMany({
      where: { id: jobId, status: { in: confirming ? ["AWAITING_CONFIRMATION"] : ["UPLOADED", "FAILED", "INTERRUPTED"] } },
      data: {
        status: "QUEUED", stage: confirming ? "FINALIZING" : job.datasetId ? "CLEANING" : "ANALYZING",
        stageTotalBytes: job.compressedBytes, stageStartedAt: new Date(),
        ...(confirming ? { metadata: JSON.stringify(metadata) } : { stageProcessedBytes: 0, processedRows: 0, importedBars: 0, totalRows: 0 }),
        totalErrors: 0, errors: "[]", workerPid: null,
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
