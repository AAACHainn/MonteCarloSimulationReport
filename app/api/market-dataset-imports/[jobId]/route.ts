import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializeImportJob } from "@/lib/market-replay/import-jobs";

type RouteContext = { params: Promise<{ jobId: string }> };
export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: copy.marketReplay.importError }, { status: 404 });
  return NextResponse.json(serializeImportJob(job));
}
export async function DELETE(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ ok: true });
  if (job.status === "PROCESSING") return NextResponse.json({ error: copy.marketReplay.importError }, { status: 409 });
  if (job.storedPath) await rm(job.storedPath, { force: true });
  await prisma.marketDatasetImport.delete({ where: { id: jobId } });
  return NextResponse.json({ ok: true });
}
