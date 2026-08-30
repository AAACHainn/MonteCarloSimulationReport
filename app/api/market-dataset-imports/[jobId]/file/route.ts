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
  const counter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length; callback(bytes > MAX_MARKET_UPLOAD_BYTES ? new Error(copy.marketReplay.validation.fileSize) : null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(request.body as never), counter, createWriteStream(path, { flags: "w" }));
    await prisma.marketDatasetImport.update({ where: { id: jobId }, data: { status: "UPLOADED", storedPath: path, compressedBytes: bytes } });
    return NextResponse.json({ ok: true, bytes });
  } catch (error) {
    await rm(path, { force: true });
    return NextResponse.json({ error: error instanceof Error ? error.message : copy.marketReplay.importError }, { status: 500 });
  }
}
