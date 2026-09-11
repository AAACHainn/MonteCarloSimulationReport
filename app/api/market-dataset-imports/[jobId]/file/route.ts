import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { ensureImportRoot, importFilePath } from "@/lib/market-replay/import-jobs";
import { MAX_MARKET_UPLOAD_BYTES } from "@/lib/market-replay/types";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ jobId: string }> };
export async function PUT(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
  if (!job || !request.body || !["CREATED", "FAILED", "INTERRUPTED"].includes(job.status)) return NextResponse.json({ error: copy.marketReplay.importError }, { status: 409 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength <= 0 || contentLength > MAX_MARKET_UPLOAD_BYTES) return NextResponse.json({ error: copy.marketReplay.validation.fileSize }, { status: 413 });
  await ensureImportRoot();
  const path = importFilePath(job.id, job.fileName);
  let bytes = 0;
  let lastPersistedBytes = 0;
  let lastPersistedAt = Date.now();
  await prisma.marketDatasetImport.update({
    where: { id: jobId },
    data: {
      status: "CREATED",
      stage: "UPLOADING", stageProcessedBytes: 0, stageTotalBytes: contentLength,
      stageStartedAt: new Date(), processedRows: 0, importedBars: 0, totalRows: 0,
      totalErrors: 0, errors: "[]",
    },
  });
  const counter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > MAX_MARKET_UPLOAD_BYTES) return callback(new Error(copy.marketReplay.validation.fileSize));
    const now = Date.now();
    if (bytes - lastPersistedBytes >= 8 * 1024 * 1024 || now - lastPersistedAt >= 1_000) {
      lastPersistedBytes = bytes;
      lastPersistedAt = now;
      void prisma.marketDatasetImport.update({
        where: { id: jobId }, data: { stageProcessedBytes: bytes },
      }).then(() => callback(null, chunk), (error) => callback(error));
      return;
    }
    callback(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(request.body as never), counter, createWriteStream(path, { flags: "w" }));
    await prisma.marketDatasetImport.update({ where: { id: jobId }, data: {
      status: "UPLOADED", storedPath: path, compressedBytes: bytes,
      stageProcessedBytes: bytes, stageTotalBytes: bytes,
    } });
    return NextResponse.json({ ok: true, bytes });
  } catch (error) {
    await rm(path, { force: true });
    await prisma.marketDatasetImport.update({
      where: { id: jobId }, data: {
        status: "CREATED", stage: "WAITING_UPLOAD", stageProcessedBytes: 0,
        stageTotalBytes: 0, stageStartedAt: null,
      },
    }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : copy.marketReplay.importError }, { status: 500 });
  }
}
