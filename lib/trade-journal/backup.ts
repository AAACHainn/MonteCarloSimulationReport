import path from "node:path";
import JSZip from "jszip";
import { z } from "zod";
import { readScreenshot, validateScreenshotBuffer } from "./storage";

export const TRADE_JOURNAL_BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_BACKUP_FILES = 1001;

const backupTradeSchema = z.object({
  date: z.string().datetime(),
  instrument: z.string().trim().min(1).max(80),
  strategy: z.string().trim().min(1).max(80),
  entryPrice: z.number().positive(),
  stopLossPrice: z.number().positive(),
  riskAmount: z.number().positive(),
  targetPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  screenshotFile: z.string().min(1),
});

const backupManifestSchema = z.object({
  version: z.literal(TRADE_JOURNAL_BACKUP_VERSION),
  journal: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(500).nullable(),
  }),
  trades: z.array(backupTradeSchema).max(MAX_BACKUP_FILES - 1),
});

export type TradeJournalBackupManifest = z.infer<typeof backupManifestSchema>;

export type ExportJournal = {
  name: string;
  description: string | null;
  trades: Array<{
    id: string;
    date: Date | null;
    instrumentOption: { name: string } | null;
    strategyOption: { name: string } | null;
    entryPrice: number | null;
    stopLossPrice: number | null;
    riskAmount: number | null;
    targetPrice: number | null;
    exitPrice: number | null;
    screenshotPath: string | null;
  }>;
};

export type ImportedJournalBackup = {
  manifest: TradeJournalBackupManifest;
  screenshots: Map<string, Buffer>;
};

export type TradeDuplicateKeySource = {
  date: Date | string | null;
  instrument: string | null | undefined;
  entryPrice: number | null;
  stopLossPrice: number | null;
  targetPrice: number | null;
};

export function buildTradeDuplicateKey(trade: TradeDuplicateKeySource) {
  if (
    !trade.date ||
    !trade.instrument ||
    trade.entryPrice === null ||
    trade.stopLossPrice === null ||
    trade.targetPrice === null
  ) {
    return null;
  }

  const date = trade.date instanceof Date ? trade.date : new Date(trade.date);
  if (Number.isNaN(date.getTime())) return null;

  return [
    date.toISOString().slice(0, 10),
    trade.instrument.trim(),
    String(trade.entryPrice),
    String(trade.stopLossPrice),
    String(trade.targetPrice),
  ].join("|");
}

export function isSafeArchivePath(value: string) {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:/.test(normalized) &&
    normalized.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

export async function createTradeJournalBackup(journal: ExportJournal) {
  const zip = new JSZip();
  const manifest: TradeJournalBackupManifest = {
    version: TRADE_JOURNAL_BACKUP_VERSION,
    journal: {
      name: journal.name,
      description: journal.description,
    },
    trades: [],
  };

  for (const trade of journal.trades) {
    if (
      !trade.date ||
      !trade.instrumentOption ||
      !trade.strategyOption ||
      trade.entryPrice === null ||
      trade.stopLossPrice === null ||
      trade.riskAmount === null ||
      trade.targetPrice === null ||
      trade.exitPrice === null ||
      !trade.screenshotPath
    ) {
      throw new Error("交易日志包含不完整的交易记录。");
    }

    const extension = path.extname(trade.screenshotPath).toLowerCase();
    const screenshotFile = `screenshots/${trade.id}${extension}`;
    zip.file(screenshotFile, await readScreenshot(trade.screenshotPath));
    manifest.trades.push({
      date: trade.date.toISOString(),
      instrument: trade.instrumentOption.name,
      strategy: trade.strategyOption.name,
      entryPrice: trade.entryPrice,
      stopLossPrice: trade.stopLossPrice,
      riskAmount: trade.riskAmount,
      targetPrice: trade.targetPrice,
      exitPrice: trade.exitPrice,
      screenshotFile,
    });
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function readTradeJournalBackup(file: File): Promise<ImportedJournalBackup> {
  if (file.size === 0 || file.size > MAX_BACKUP_BYTES) {
    throw new Error("ZIP 备份大小必须在 100 MB 以内。");
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length === 0 || entries.length > MAX_BACKUP_FILES) {
    throw new Error("ZIP 备份包含的文件数量无效。");
  }

  for (const entry of entries) {
    const originalName = "unsafeOriginalName" in entry ? String(entry.unsafeOriginalName) : entry.name;
    if (!isSafeArchivePath(originalName)) {
      throw new Error("ZIP 备份包含不安全的文件路径。");
    }
  }

  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) {
    throw new Error("ZIP 备份缺少 manifest.json。");
  }

  const manifest = backupManifestSchema.parse(JSON.parse(await manifestEntry.async("string")));
  const expectedFiles = new Set(["manifest.json"]);
  const screenshots = new Map<string, Buffer>();

  for (const trade of manifest.trades) {
    if (!isSafeArchivePath(trade.screenshotFile) || !trade.screenshotFile.startsWith("screenshots/")) {
      throw new Error("ZIP 备份中的截图路径无效。");
    }
    const screenshotEntry = zip.file(trade.screenshotFile);
    if (!screenshotEntry) {
      throw new Error("ZIP 备份缺少交易截图。");
    }
    const buffer = await screenshotEntry.async("nodebuffer");
    validateScreenshotBuffer(buffer, trade.screenshotFile);
    screenshots.set(trade.screenshotFile, buffer);
    expectedFiles.add(trade.screenshotFile);
  }

  if (entries.some((entry) => !expectedFiles.has(entry.name))) {
    throw new Error("ZIP 备份包含未声明的文件。");
  }

  return { manifest, screenshots };
}
