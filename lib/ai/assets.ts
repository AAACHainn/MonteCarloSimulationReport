import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { validateScreenshotBuffer } from "@/lib/trade-journal/storage";
import { AiError } from "./errors";
import { LIMITS } from "./schema";
import type { Prisma } from "@prisma/client";
import { readContext } from "./context";

const assetPath = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new AiError("ASSET", copy.ai.invalid);
  return join(process.cwd(), "storage", "ai", id);
};
export async function saveAsset(dataUrl: string, contextId?: string, chartHash?: string) {
  if (chartHash && (!contextId || !(await readContext(contextId)).charts.some((c) => c.hash === chartHash))) throw new AiError("ASSET_SCOPE", copy.ai.invalid);
  return storeChartAsset(dataUrl, contextId, chartHash);
}
// Called by the capture-task completion path after validating its lease and frozen variant.
export async function storeChartAsset(dataUrl: string, contextId?: string, chartHash?: string, client: Prisma.TransactionClient = prisma) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new AiError("ASSET", copy.ai.uploadLimit);
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > LIMITS.imageBytes) throw new AiError("ASSET", copy.ai.uploadLimit);
  validateScreenshotBuffer(bytes, match[1] === "image/jpeg" ? "image.jpg" : match[1] === "image/webp" ? "image.webp" : "image.png");
  const id = randomUUID(); await mkdir(join(process.cwd(), "storage", "ai"), { recursive: true });
  await writeFile(assetPath(id), bytes, { flag: "wx" });
  return client.aiAsset.create({ data: { id, mime: match[1], bytes: bytes.length, contextId, chartHash, contentHash: createHash("sha256").update(bytes).digest("hex") } });
}
export async function assetDataUrl(id: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const row = await prisma.aiAsset.findUnique({ where: { id } });
  if (!row) throw new AiError("ASSET_MISSING", copy.ai.missing);
  signal?.throwIfAborted();
  const bytes = await readFile(assetPath(id), { signal });
  signal?.throwIfAborted();
  if (bytes.length !== row.bytes || (row.contentHash && createHash("sha256").update(bytes).digest("hex") !== row.contentHash)) throw new AiError("ASSET_MISMATCH", copy.ai.invalid);
  return "data:" + row.mime + ";base64," + bytes.toString("base64");
}
export async function readAsset(id: string) {
  const row = await prisma.aiAsset.findUnique({ where: { id } });
  if (!row) throw new AiError("ASSET_MISSING", copy.ai.missing, 404);
  return { bytes: await readFile(assetPath(id)), mime: row.mime };
}
