import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeImportJob } from "@/lib/market-replay/import-jobs";

type RouteContext = { params: Promise<{ jobId: string }> };
export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  await prisma.marketDatasetImport.updateMany({
    where: {
      id: jobId, status: { in: ["QUEUED", "PROCESSING"] },
      updatedAt: { lt: new Date(Date.now() - 60_000) },
    },
    data: { status: "INTERRUPTED", workerPid: null },
  }).catch(() => undefined);
  const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: copy.marketReplay.importError }, { status: 404 });
  return NextResponse.json(serializeImportJob(job));
}
export async function DELETE(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ ok: true });
  if (["QUEUED", "PROCESSING"].includes(job.status) || (job.status === "CREATED" && job.stage === "UPLOADING")) {
    return NextResponse.json({ error: copy.marketReplay.importError }, { status: 409 });
  }
  if (job.storedPath) await rm(job.storedPath, { force: true });
  if (job.datasetId) await prisma.marketDataset.deleteMany({ where: { id: job.datasetId, status: "IMPORTING" } });
  await prisma.marketDatasetImport.delete({ where: { id: jobId } });
  return NextResponse.json({ ok: true });
}
