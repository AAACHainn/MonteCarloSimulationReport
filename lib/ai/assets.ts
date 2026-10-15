import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { validateScreenshotBuffer } from "@/lib/trade-journal/storage";
import { AiError } from "./errors";
import { LIMITS } from "./schema";
import { readContext } from "./context";

const assetPath = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new AiError("ASSET", copy.ai.invalid);
  return join(process.cwd(), "storage", "ai", id);
};
export async function saveAsset(dataUrl: string, contextId?: string, chartHash?: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new AiError("ASSET", copy.ai.uploadLimit);
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > LIMITS.imageBytes) throw new AiError("ASSET", copy.ai.uploadLimit);
  validateScreenshotBuffer(bytes, match[1] === "image/jpeg" ? "image.jpg" : match[1] === "image/webp" ? "image.webp" : "image.png");
  if (chartHash) {
    if (!contextId || !(await readContext(contextId)).charts.some((c) => c.hash === chartHash)) throw new AiError("ASSET_SCOPE", copy.ai.invalid);
  }
  const id = randomUUID(); await mkdir(join(process.cwd(), "storage", "ai"), { recursive: true });
  await writeFile(assetPath(id), bytes, { flag: "wx" });
  return prisma.aiAsset.create({ data: { id, mime: match[1], bytes: bytes.length, contextId, chartHash } });
}
export async function assetDataUrl(id: string) {
  const row = await prisma.aiAsset.findUnique({ where: { id } });
  if (!row) throw new AiError("ASSET_MISSING", copy.ai.missing);
  const bytes = await readFile(assetPath(id));
  return "data:" + row.mime + ";base64," + bytes.toString("base64");
}
export async function readAsset(id: string) {
  const row = await prisma.aiAsset.findUnique({ where: { id } });
  if (!row) throw new AiError("ASSET_MISSING", copy.ai.missing, 404);
  return { bytes: await readFile(assetPath(id)), mime: row.mime };
}
