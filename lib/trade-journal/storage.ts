import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const JOURNAL_STORAGE_ROOT = path.join(process.cwd(), "storage", "trade-journals");

const screenshotTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

const mimeTypesByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export class ScreenshotValidationError extends Error {}

function matchesScreenshotSignature(buffer: Buffer, extension: string) {
  if (extension === ".jpg" || extension === ".jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === ".png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === ".webp") {
    return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

function assertSafeSegment(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ScreenshotValidationError("截图存储标识无效。");
  }
}

export function validateScreenshotBuffer(buffer: Buffer, originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  if (!mimeTypesByExtension[extension]) {
    throw new ScreenshotValidationError("截图仅支持 JPG、PNG 或 WEBP 格式。");
  }
  if (buffer.length === 0 || buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new ScreenshotValidationError("截图大小必须在 10 MB 以内。");
  }
  if (!matchesScreenshotSignature(buffer, extension)) {
    throw new ScreenshotValidationError("截图内容与文件格式不匹配。");
  }
  return extension === ".jpeg" ? ".jpg" : extension;
}

export function createScreenshotFilename(instrumentName: string, timestamp: number, extension: string, suffix = 0) {
  const safeInstrumentName = Array.from(instrumentName.trim())
    .map((character) => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? "-" : character)
    .join("")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 80)
    .replace(/[. -]+$/g, "") || "trade";
  const collisionSuffix = suffix === 0 ? "" : `-${suffix}`;
  return `${safeInstrumentName}-${timestamp}${collisionSuffix}${extension}`;
}

export async function writeUploadedScreenshot(journalId: string, instrumentName: string, file: File) {
  const extension = screenshotTypes[file.type as keyof typeof screenshotTypes];
  if (!extension) {
    throw new ScreenshotValidationError("截图仅支持 JPG、PNG 或 WEBP 格式。");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new ScreenshotValidationError("截图大小必须在 10 MB 以内。");
  }

  return writeScreenshotBuffer(journalId, instrumentName, extension, buffer);
}

export async function writeScreenshotBuffer(journalId: string, instrumentName: string, extension: string, buffer: Buffer) {
  assertSafeSegment(journalId);
  const normalizedExtension = validateScreenshotBuffer(buffer, `screenshot${extension}`);
  const directory = path.join(JOURNAL_STORAGE_ROOT, journalId);
  const timestamp = Date.now();

  await mkdir(directory, { recursive: true });
  for (let suffix = 0; ; suffix += 1) {
    const filename = createScreenshotFilename(instrumentName, timestamp, normalizedExtension, suffix);
    try {
      await writeFile(path.join(directory, filename), buffer, { flag: "wx" });
      return `${journalId}/${filename}`;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }
  }
}

export function resolveScreenshotPath(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new ScreenshotValidationError("截图路径无效。");
  }

  const absolutePath = path.resolve(JOURNAL_STORAGE_ROOT, normalized);
  const rootPrefix = `${path.resolve(JOURNAL_STORAGE_ROOT)}${path.sep}`;
  if (!absolutePath.startsWith(rootPrefix)) {
    throw new ScreenshotValidationError("截图路径无效。");
  }
  return absolutePath;
}

export async function readScreenshot(relativePath: string) {
  return readFile(resolveScreenshotPath(relativePath));
}

export function getScreenshotMimeType(relativePath: string) {
  return mimeTypesByExtension[path.extname(relativePath).toLowerCase()] ?? "application/octet-stream";
}

export async function removeScreenshot(relativePath: string | null | undefined) {
  if (!relativePath) return;
  await rm(resolveScreenshotPath(relativePath), { force: true });
}

export async function removeJournalScreenshots(journalId: string) {
  assertSafeSegment(journalId);
  await rm(path.join(JOURNAL_STORAGE_ROOT, journalId), { recursive: true, force: true });
}
