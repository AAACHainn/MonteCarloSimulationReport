import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { marketDatasetImportSchema, marketDatasetSchema } from "@/lib/validations";
import { formatInterval } from "@/lib/market-replay/types";
import { serializeImportJob } from "@/lib/market-replay/import-jobs";

export async function GET() {
  const staleBefore = new Date(Date.now() - 60_000);
  await prisma.marketDatasetImport.updateMany({
    where: { status: { in: ["QUEUED", "PROCESSING"] }, updatedAt: { lt: staleBefore } },
    data: { status: "INTERRUPTED", workerPid: null },
  }).catch(() => undefined);
  const jobs = await prisma.marketDatasetImport.findMany({
    where: { status: { in: ["CREATED", "UPLOADED", "QUEUED", "PROCESSING", "AWAITING_CONFIRMATION", "FAILED", "INTERRUPTED"] } },
    orderBy: { createdAt: "desc" }, take: 10,
  });
  return NextResponse.json(jobs.map((job) => serializeImportJob(job)));
}

export async function POST(request: Request) {
  const input = await request.json();
  if (input.mode === "APPEND") {
    if (typeof input.targetDatasetId !== "string" || typeof input.fileName !== "string" || !/\.csv(?:\.gz)?$/i.test(input.fileName)) {
      return NextResponse.json({ error: copy.marketReplay.validation.csvRequired }, { status: 400 });
    }
    const dataset = await prisma.marketDataset.findUnique({ where: { id: input.targetDatasetId } });
    if (!dataset || dataset.status !== "READY") return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
    if (!dataset.sourceIntervalSeconds) return NextResponse.json({ error: copy.marketReplay.appendIntervalRequired }, { status: 400 });
    if (typeof input.symbol !== "string" || input.symbol.trim().toUpperCase() !== dataset.symbol.trim().toUpperCase()) {
      return NextResponse.json({ error: copy.marketReplay.appendSymbolMismatch(dataset.symbol) }, { status: 400 });
    }
    if (input.sourceIntervalSeconds !== dataset.sourceIntervalSeconds) {
      return NextResponse.json({ error: copy.marketReplay.appendIntervalMismatch(formatInterval(dataset.sourceIntervalSeconds)) }, { status: 400 });
    }
    const validated = marketDatasetSchema.parse({ ...dataset, description: dataset.description ?? "" });
    const job = await prisma.marketDatasetImport.create({ data: {
      fileName: input.fileName, stage: "WAITING_UPLOAD",
      metadata: JSON.stringify({ ...validated, mode: "APPEND", targetDatasetId: dataset.id }),
    } });
    return NextResponse.json(serializeImportJob(job), { status: 201 });
  }
  const metadata = marketDatasetImportSchema.safeParse(input);
  if (!metadata.success || typeof input.fileName !== "string" || !/\.csv(?:\.gz)?$/i.test(input.fileName)) {
    return NextResponse.json({ error: metadata.success ? copy.marketReplay.validation.csvRequired : metadata.error.issues[0]?.message }, { status: 400 });
  }
  const job = await prisma.marketDatasetImport.create({
    data: { fileName: input.fileName, metadata: JSON.stringify(metadata.data), stage: "WAITING_UPLOAD" },
  });
  return NextResponse.json(serializeImportJob(job), { status: 201 });
}
