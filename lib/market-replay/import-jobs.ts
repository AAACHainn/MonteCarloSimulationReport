import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import {
  MARKET_REQUIRED_COLUMNS, parseMarketCsvRow, type CsvRow, type MarketCsvIssue,
} from "./parse-market-bars";
import { MARKET_BAR_BLOCK_SIZE, MAX_MARKET_BARS, MAX_MARKET_EXPANDED_BYTES } from "./types";
import { marketDatasetSchema } from "@/lib/validations";

export const MARKET_IMPORT_ROOT = join(process.cwd(), ".market-imports");
const INSERT_CHUNK_SIZE = 1_000;

export function importFilePath(jobId: string, fileName: string) {
  const suffix = fileName.toLowerCase().endsWith(".csv.gz") ? ".csv.gz" : ".csv";
  return join(MARKET_IMPORT_ROOT, `${jobId}${suffix}`);
}

export function serializeImportJob(job: {
  id: string; datasetId: string | null; status: string; fileName: string; compressedBytes: bigint;
  expandedBytes: bigint; processedRows: number; totalErrors: number; errors: string; createdAt: Date; updatedAt: Date;
}) {
  return {
    ...job, compressedBytes: Number(job.compressedBytes), expandedBytes: Number(job.expandedBytes),
    errors: JSON.parse(job.errors) as MarketCsvIssue[], createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
  };
}

type BlockAccumulator = {
  startSequence: number; endSequence: number; startTime: Date; endTime: Date;
  open: number; high: number; low: number; close: number; volume: number | null; volumeCount: number; barCount: number;
};

function addToBlock(block: BlockAccumulator | null, bar: NonNullable<ReturnType<typeof parseMarketCsvRow>["bar"]>) {
  if (!block) return {
    startSequence: bar.sequence, endSequence: bar.sequence, startTime: bar.timestamp, endTime: bar.timestamp,
    open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
    volumeCount: bar.volume === null ? 0 : 1, barCount: 1,
  };
  block.endSequence = bar.sequence; block.endTime = bar.timestamp; block.high = Math.max(block.high, bar.high);
  block.low = Math.min(block.low, bar.low); block.close = bar.close; block.barCount += 1;
  if (bar.volume !== null) { block.volume = (block.volume ?? 0) + bar.volume; block.volumeCount += 1; }
  return block;
}

export async function processImportJob(jobId: string) {
  const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
  if (!job?.storedPath || !["UPLOADED", "FAILED", "INTERRUPTED"].includes(job.status)) throw new Error(copy.marketReplay.importError);
  const metadata = marketDatasetSchema.parse(JSON.parse(job.metadata));
  const fileInfo = await stat(job.storedPath);
  if (!fileInfo.isFile()) throw new Error(copy.marketReplay.importError);

  await prisma.marketDatasetImport.update({ where: { id: jobId }, data: { status: "PROCESSING", processedRows: 0, totalErrors: 0, errors: "[]", expandedBytes: 0 } });
  let datasetId: string | null = null;
  const issues: MarketCsvIssue[] = [];
  let totalIssues = 0;
  let expandedBytes = 0;
  let rowCount = 0;
  let previousTime = Number.NEGATIVE_INFINITY;
  let previousChartSecond = Number.NEGATIVE_INFINITY;
  let firstTime: Date | null = null;
  let lastTime: Date | null = null;
  let chunk: NonNullable<ReturnType<typeof parseMarketCsvRow>["bar"]>[] = [];
  let blocks: BlockAccumulator[] = [];
  let block: BlockAccumulator | null = null;
  try {
    const dataset = await prisma.marketDataset.create({
      data: {
        name: metadata.name, description: metadata.description || null, symbol: metadata.symbol,
        timeframe: metadata.timeframe, timezone: metadata.timezone, status: "IMPORTING",
        sourceIntervalSeconds: metadata.sourceIntervalSeconds, sessionMode: metadata.sessionMode,
        sessionOpenMinute: metadata.sessionOpenMinute ?? null, sessionCloseMinute: metadata.sessionCloseMinute ?? null,
        tradingWeekdays: metadata.tradingWeekdays.join(","), barCount: 0,
        startTime: new Date(0), endTime: new Date(0),
      },
    });
    datasetId = dataset.id;
    await prisma.marketDatasetImport.update({ where: { id: jobId }, data: { datasetId } });

    const counter = new Transform({ transform(buffer, _encoding, callback) {
      expandedBytes += buffer.length;
      if (expandedBytes > MAX_MARKET_EXPANDED_BYTES) callback(new Error(copy.marketReplay.validation.fileSize));
      else callback(null, buffer);
    } });
    const input = createReadStream(job.storedPath);
    const decoded = job.fileName.toLowerCase().endsWith(".gz") ? input.pipe(createGunzip()).pipe(counter) : input.pipe(counter);
    const parser = decoded.pipe(parse({
      bom: true, trim: true, skip_empty_lines: true,
      columns(headers: string[]) {
        const normalized = headers.map((header) => header.trim().toLowerCase());
        const missing = MARKET_REQUIRED_COLUMNS.filter((column) => !normalized.includes(column));
        if (missing.length) throw new Error(copy.marketReplay.validation.missingColumns(missing.join(", ")));
        return normalized;
      },
    }));

    const flush = async () => {
      if (chunk.length) {
        await prisma.marketBar.createMany({ data: chunk.map((bar) => ({ ...bar, datasetId: dataset.id })) });
        chunk = [];
      }
      if (blocks.length) {
        await prisma.marketBarBlock.createMany({ data: blocks.map((item) => ({ ...item, datasetId: dataset.id })) });
        blocks = [];
      }
      await prisma.marketDatasetImport.update({ where: { id: jobId }, data: { processedRows: rowCount, expandedBytes } });
    };

    for await (const record of parser as AsyncIterable<CsvRow>) {
      if (rowCount >= MAX_MARKET_BARS) {
        totalIssues += 1; if (issues.length < 20) issues.push({ row: rowCount + 2, reason: copy.marketReplay.validation.maximumRows(MAX_MARKET_BARS) });
        break;
      }
      const parsed = parseMarketCsvRow({
        row: record, rowNumber: rowCount + 2, sequence: rowCount, timezone: metadata.timezone,
        options: { sourceIntervalSeconds: metadata.sourceIntervalSeconds, session: {
          mode: metadata.sessionMode, timezone: metadata.timezone, openMinute: metadata.sessionOpenMinute ?? null,
          closeMinute: metadata.sessionCloseMinute ?? null, weekdays: metadata.tradingWeekdays,
        } }, previousTime, previousChartSecond,
      });
      rowCount += 1;
      if (parsed.issues.length || !parsed.bar) {
        totalIssues += parsed.issues.length; if (issues.length < 20) issues.push(...parsed.issues.slice(0, 20 - issues.length));
      } else {
        previousTime = parsed.time; previousChartSecond = parsed.chartSecond;
        firstTime ??= parsed.bar.timestamp; lastTime = parsed.bar.timestamp; chunk.push(parsed.bar);
        block = addToBlock(block, parsed.bar);
        if (block.barCount === MARKET_BAR_BLOCK_SIZE) { blocks.push(block); block = null; }
      }
      if (rowCount % INSERT_CHUNK_SIZE === 0) await flush();
      if (totalIssues > 1_000) break;
    }
    if (block) blocks.push(block);
    await flush();
    if (rowCount < 2) { totalIssues += 1; issues.push({ row: 1, reason: copy.marketReplay.validation.minimumRows }); }
    if (totalIssues || !firstTime || !lastTime) throw new Error(issues[0]?.reason ?? copy.marketReplay.importError);
    await prisma.$transaction([
      prisma.marketDataset.update({ where: { id: dataset.id }, data: { status: "READY", barCount: rowCount, startTime: firstTime, endTime: lastTime } }),
      prisma.marketDatasetImport.update({ where: { id: jobId }, data: { status: "COMPLETED", processedRows: rowCount, expandedBytes, totalErrors: 0, errors: "[]" } }),
    ]);
    await rm(job.storedPath, { force: true });
  } catch (error) {
    if (datasetId) await prisma.marketDataset.deleteMany({ where: { id: datasetId } });
    const fallback = error instanceof Error ? error.message : copy.marketReplay.importError;
    if (!issues.length) issues.push({ row: Math.max(1, rowCount + 1), reason: fallback });
    await prisma.marketDatasetImport.update({ where: { id: jobId }, data: {
      datasetId: null, status: "FAILED", processedRows: rowCount, expandedBytes,
      totalErrors: Math.max(totalIssues, issues.length), errors: JSON.stringify(issues.slice(0, 20)),
    } });
    throw error;
  }
}

export async function ensureImportRoot() {
  await mkdir(MARKET_IMPORT_ROOT, { recursive: true });
}
