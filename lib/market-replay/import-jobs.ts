import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import {
  createCsvColumnIndexes,
  databentoSourceIntervalSeconds,
  inspectMarketCsvHeaders,
  parseFiniteNumber,
  parseMarketCsvRow,
  parseMarketTimestamp,
  readCsvValue,
  type CsvColumnIndexes,
  type CsvValues,
  type MarketCsvFormat,
  type MarketCsvIssue,
  type ParsedMarketBar,
} from "./parse-market-bars";
import { MARKET_BAR_BLOCK_SIZE, MAX_MARKET_BARS, MAX_MARKET_EXPANDED_BYTES, formatInterval } from "./types";
import { marketDatasetImportSchema, marketDatasetSchema } from "@/lib/validations";
import {
  addCmeDailyVolume,
  buildCmeVolumeLeadMap,
  normalizeCmeOutrightSymbol,
  type CmeDailyVolumes,
} from "./cme-contracts";
import { calculateImportProgress } from "./import-progress";

export const MARKET_IMPORT_ROOT = join(process.cwd(), ".market-imports");
const INSERT_CHUNK_SIZE = 1_000;
const PROGRESS_UPDATE_MS = 1_000;

export function importFilePath(jobId: string, fileName: string) {
  const suffix = fileName.toLowerCase().endsWith(".csv.gz") ? ".csv.gz" : ".csv";
  return join(MARKET_IMPORT_ROOT, `${jobId}${suffix}`);
}

type SerializableImportJob = {
  id: string; datasetId: string | null; status: string; fileName: string; compressedBytes: bigint;
  expandedBytes: bigint; processedRows: number; importedBars: number; totalErrors: number; errors: string;
  stage: string; stageProcessedBytes: bigint; stageTotalBytes: bigint; totalRows: number;
  stageStartedAt: Date | null; workerPid: number | null; workerRssBytes: bigint; peakWorkerRssBytes: bigint;
  createdAt: Date; updatedAt: Date;
};

export function serializeImportJob(job: SerializableImportJob, now = Date.now()) {
  return {
    ...job,
    compressedBytes: Number(job.compressedBytes),
    expandedBytes: Number(job.expandedBytes),
    stageProcessedBytes: Number(job.stageProcessedBytes),
    stageTotalBytes: Number(job.stageTotalBytes),
    workerRssBytes: Number(job.workerRssBytes),
    peakWorkerRssBytes: Number(job.peakWorkerRssBytes),
    errors: JSON.parse(job.errors) as MarketCsvIssue[],
    stageStartedAt: job.stageStartedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...calculateImportProgress(job, now),
  };
}

type BlockAccumulator = {
  startSequence: number; endSequence: number; startTime: Date; endTime: Date;
  open: number; high: number; low: number; close: number; volume: number | null; volumeCount: number; barCount: number;
};

function addToBlock(block: BlockAccumulator | null, bar: ParsedMarketBar) {
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

function countedCsvStream(path: string, fileName: string) {
  let rawBytes = 0;
  let expandedBytes = 0;
  const rawCounter = new Transform({ transform(buffer, _encoding, callback) {
    rawBytes += buffer.length;
    callback(null, buffer);
  } });
  const expandedCounter = new Transform({ transform(buffer, _encoding, callback) {
    expandedBytes += buffer.length;
    callback(expandedBytes > MAX_MARKET_EXPANDED_BYTES ? new Error(copy.marketReplay.validation.fileSize) : null, buffer);
  } });
  const countedInput = createReadStream(path).pipe(rawCounter);
  const stream = fileName.toLowerCase().endsWith(".gz")
    ? countedInput.pipe(createGunzip()).pipe(expandedCounter)
    : countedInput.pipe(expandedCounter);
  return { stream, rawBytes: () => rawBytes, expandedBytes: () => expandedBytes };
}

function mostCommonInterval(intervalCounts: Map<number, number>) {
  let selected: number | null = null;
  let selectedCount = 0;
  for (const [interval, count] of intervalCounts) {
    if (count > selectedCount || (count === selectedCount && (selected === null || interval < selected))) {
      selected = interval;
      selectedCount = count;
    }
  }
  return selected;
}

type WorkerMemory = { peakRssBytes: number };

function memorySnapshot(memory: WorkerMemory) {
  const rss = process.memoryUsage().rss;
  memory.peakRssBytes = Math.max(memory.peakRssBytes, rss);
  return { workerRssBytes: rss, peakWorkerRssBytes: memory.peakRssBytes };
}

function startWorkerHeartbeat(jobId: string, memory: WorkerMemory) {
  const heartbeat = setInterval(() => {
    void prisma.marketDatasetImport.updateMany({
      where: { id: jobId, status: "PROCESSING" },
      data: { ...memorySnapshot(memory) },
    }).catch(() => undefined);
  }, 10_000);
  heartbeat.unref();
  return heartbeat;
}

function inspectHeaders(values: CsvValues) {
  const inspected = inspectMarketCsvHeaders(values);
  if (inspected.missingColumns.length) {
    throw new Error(copy.marketReplay.validation.missingColumns(inspected.missingColumns.join(", ")));
  }
  return { format: inspected.format, columns: createCsvColumnIndexes(inspected.normalizedHeaders) };
}

async function inspectImportFile(job: { id: string; storedPath: string; fileName: string; compressedBytes: bigint }, metadata: {
  timezone: string;
  symbol: string;
  sourceIntervalSeconds: number | null;
}, memory: WorkerMemory) {
  let rowCount = 0;
  let header: { format: MarketCsvFormat; columns: CsvColumnIndexes } | null = null;
  let lastProgressAt = 0;
  const databentoIntervals = new Set<number>();
  const intervalCounts = new Map<number, number>();
  const dailyVolumes: CmeDailyVolumes = new Map();
  let previousStandardTimestamp: number | null = null;
  const source = countedCsvStream(job.storedPath, job.fileName);
  const parser = source.stream.pipe(parse({ bom: true, trim: true, skip_empty_lines: true }));

  const persistProgress = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_UPDATE_MS) return;
    lastProgressAt = now;
    await prisma.marketDatasetImport.update({
      where: { id: job.id },
      data: {
        processedRows: rowCount,
        expandedBytes: source.expandedBytes(),
        stageProcessedBytes: source.rawBytes(),
        stageTotalBytes: job.compressedBytes,
        ...memorySnapshot(memory),
      },
    });
  };

  for await (const values of parser as AsyncIterable<CsvValues>) {
    if (!header) {
      header = inspectHeaders(values);
      continue;
    }
    rowCount += 1;
    if (header.format === "DATABENTO_CME") {
      const interval = databentoSourceIntervalSeconds(values, header.columns);
      if (interval === null) throw new Error(copy.marketReplay.validation.unsupportedDatabentoRtype);
      databentoIntervals.add(interval);
      const symbol = normalizeCmeOutrightSymbol(readCsvValue(values, "symbol", header.columns), metadata.symbol);
      if (symbol) {
        const timestamp = parseMarketTimestamp(readCsvValue(values, "ts_event", header.columns), metadata.timezone);
        const volume = parseFiniteNumber(readCsvValue(values, "volume", header.columns));
        if (!timestamp) throw new Error(copy.marketReplay.validation.invalidTimestamp);
        if (volume === null || volume < 0) throw new Error(copy.marketReplay.validation.invalidVolume);
        addCmeDailyVolume(dailyVolumes, timestamp, symbol, volume);
      }
    } else if (metadata.sourceIntervalSeconds === null) {
      const timestamp = parseMarketTimestamp(readCsvValue(values, "timestamp", header.columns), metadata.timezone)?.getTime() ?? null;
      if (timestamp !== null && previousStandardTimestamp !== null) {
        const interval = (timestamp - previousStandardTimestamp) / 1_000;
        if (Number.isInteger(interval) && interval >= 1 && interval <= 86_400) {
          intervalCounts.set(interval, (intervalCounts.get(interval) ?? 0) + 1);
        }
      }
      if (timestamp !== null) previousStandardTimestamp = timestamp;
    }
    if (rowCount % INSERT_CHUNK_SIZE === 0) await persistProgress();
  }
  if (!header) throw new Error(copy.marketReplay.validation.minimumRows);
  await persistProgress(true);
  if (header.format === "DATABENTO_CME" && databentoIntervals.size !== 1) {
    throw new Error(copy.marketReplay.validation.unsupportedDatabentoRtype);
  }
  return {
    format: header.format,
    rowCount,
    expandedBytes: source.expandedBytes(),
    detectedSourceIntervalSeconds: header.format === "DATABENTO_CME"
      ? [...databentoIntervals][0] ?? null
      : mostCommonInterval(intervalCounts),
    cmeLeadByDate: header.format === "DATABENTO_CME" ? buildCmeVolumeLeadMap(dailyVolumes) : undefined,
  };
}

export async function processImportJob(jobId: string) {
  const job = await prisma.marketDatasetImport.findUnique({ where: { id: jobId } });
  if (!job?.storedPath || !["QUEUED", "UPLOADED", "FAILED", "INTERRUPTED"].includes(job.status)) {
    throw new Error(copy.marketReplay.importError);
  }
  const fileInfo = await stat(job.storedPath);
  if (!fileInfo.isFile()) throw new Error(copy.marketReplay.importError);
  const claimed = await prisma.marketDatasetImport.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "UPLOADED", "FAILED", "INTERRUPTED"] } },
    data: {
      status: "PROCESSING",
      stage: job.datasetId ? "CLEANING" : "ANALYZING",
      stageProcessedBytes: 0,
      stageTotalBytes: job.compressedBytes,
      stageStartedAt: new Date(),
      workerPid: process.pid,
      workerRssBytes: process.memoryUsage().rss,
      processedRows: 0,
      importedBars: 0,
      totalRows: 0,
      totalErrors: 0,
      errors: "[]",
      expandedBytes: 0,
    },
  });
  if (claimed.count !== 1) throw new Error(copy.marketReplay.importError);

  let datasetId: string | null = null;
  const issues: MarketCsvIssue[] = [];
  let totalIssues = 0;
  let rowCount = 0;
  let importedBarCount = 0;
  const memory: WorkerMemory = { peakRssBytes: process.memoryUsage().rss };
  const heartbeat = startWorkerHeartbeat(jobId, memory);
  try {
    if (job.datasetId) {
      await prisma.marketDataset.deleteMany({ where: { id: job.datasetId, status: "IMPORTING" } });
      await prisma.marketDatasetImport.update({ where: { id: jobId }, data: { datasetId: null } });
    }
    const requestedMetadata = marketDatasetImportSchema.parse(JSON.parse(job.metadata));
    await prisma.marketDatasetImport.update({
      where: { id: jobId },
      data: {
        stage: "ANALYZING", stageProcessedBytes: 0, stageTotalBytes: job.compressedBytes,
        stageStartedAt: new Date(), processedRows: 0, ...memorySnapshot(memory),
      },
    });
    const inspection = await inspectImportFile({
      id: jobId, storedPath: job.storedPath, fileName: job.fileName, compressedBytes: job.compressedBytes,
    }, requestedMetadata, memory);
    const detectedSourceInterval = inspection.detectedSourceIntervalSeconds;
    if (requestedMetadata.sourceIntervalSeconds !== null && inspection.format === "DATABENTO_CME"
      && requestedMetadata.sourceIntervalSeconds !== detectedSourceInterval) {
      throw new Error(copy.marketReplay.validation.sourceIntervalMismatch(
        detectedSourceInterval === null ? copy.common.dash : formatInterval(detectedSourceInterval),
      ));
    }
    const sourceIntervalSeconds = requestedMetadata.sourceIntervalSeconds ?? detectedSourceInterval;
    if (sourceIntervalSeconds === null) throw new Error(copy.marketReplay.validation.sourceIntervalUndetected);
    const metadata = marketDatasetSchema.parse({
      ...requestedMetadata,
      sourceIntervalSeconds,
      timeframe: formatInterval(sourceIntervalSeconds),
    });
    rowCount = 0;
    const dataset = await prisma.marketDataset.create({
      data: {
        name: metadata.name, description: metadata.description || null, symbol: metadata.symbol,
        timeframe: metadata.timeframe, timezone: metadata.timezone, status: "IMPORTING",
        sourceIntervalSeconds: metadata.sourceIntervalSeconds, priceTickSize: metadata.priceTickSize, sessionMode: metadata.sessionMode,
        sessionOpenMinute: metadata.sessionOpenMinute ?? null, sessionCloseMinute: metadata.sessionCloseMinute ?? null,
        tradingWeekdays: metadata.tradingWeekdays.join(","), barCount: 0,
        startTime: new Date(0), endTime: new Date(0),
      },
    });
    datasetId = dataset.id;
    await prisma.marketDatasetImport.update({
      where: { id: jobId },
      data: {
        datasetId, totalRows: inspection.rowCount, processedRows: 0, importedBars: 0,
        expandedBytes: inspection.expandedBytes, stage: "IMPORTING", stageProcessedBytes: 0,
        stageTotalBytes: job.compressedBytes, stageStartedAt: new Date(), ...memorySnapshot(memory),
      },
    });

    const source = countedCsvStream(job.storedPath, job.fileName);
    const parser = source.stream.pipe(parse({ bom: true, trim: true, skip_empty_lines: true }));
    let header: { format: MarketCsvFormat; columns: CsvColumnIndexes } | null = null;
    let previousTime = Number.NEGATIVE_INFINITY;
    let previousChartSecond = Number.NEGATIVE_INFINITY;
    let firstTime: Date | null = null;
    let lastTime: Date | null = null;
    let chunk: Array<ParsedMarketBar & { datasetId: string }> = [];
    let blocks: BlockAccumulator[] = [];
    let block: BlockAccumulator | null = null;
    let lastProgressAt = 0;

    const persistProgress = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_UPDATE_MS) return;
      lastProgressAt = now;
      await prisma.marketDatasetImport.update({
        where: { id: jobId },
        data: {
          processedRows: rowCount, importedBars: importedBarCount,
          stageProcessedBytes: source.rawBytes(), stageTotalBytes: job.compressedBytes,
          ...memorySnapshot(memory),
        },
      });
    };

    const flush = async (forceProgress = false) => {
      if (chunk.length) {
        await prisma.marketBar.createMany({ data: chunk });
        chunk = [];
      }
      if (blocks.length) {
        await prisma.marketBarBlock.createMany({ data: blocks.map((item) => ({ ...item, datasetId: dataset.id })) });
        blocks = [];
      }
      await persistProgress(forceProgress);
    };

    for await (const values of parser as AsyncIterable<CsvValues>) {
      if (!header) {
        header = inspectHeaders(values);
        continue;
      }
      const rowNumber = rowCount + 2;
      const parsed = parseMarketCsvRow({
        row: values, columnIndexes: header.columns, rowNumber, sequence: importedBarCount,
        timezone: metadata.timezone, format: header.format,
        options: { sourceIntervalSeconds: metadata.sourceIntervalSeconds, session: {
          mode: metadata.sessionMode, timezone: metadata.timezone, openMinute: metadata.sessionOpenMinute ?? null,
          closeMinute: metadata.sessionCloseMinute ?? null, weekdays: metadata.tradingWeekdays,
        }, cmeRootSymbol: metadata.symbol, cmeLeadByDate: inspection.cmeLeadByDate }, previousTime, previousChartSecond,
      });
      rowCount += 1;
      if (parsed.skipped) {
        // Non-lead contracts and unrelated symbols are intentionally ignored.
      } else if (parsed.issues.length || !parsed.bar) {
        totalIssues += parsed.issues.length;
        if (issues.length < 20) issues.push(...parsed.issues.slice(0, 20 - issues.length));
      } else {
        if (importedBarCount >= MAX_MARKET_BARS) {
          totalIssues += 1;
          if (issues.length < 20) issues.push({ row: rowNumber, reason: copy.marketReplay.validation.maximumRows(MAX_MARKET_BARS) });
          break;
        }
        previousTime = parsed.time; previousChartSecond = parsed.chartSecond;
        importedBarCount += 1;
        firstTime ??= parsed.bar.timestamp; lastTime = parsed.bar.timestamp;
        chunk.push({ ...parsed.bar, datasetId: dataset.id });
        block = addToBlock(block, parsed.bar);
        if (block.barCount === MARKET_BAR_BLOCK_SIZE) { blocks.push(block); block = null; }
      }
      if (rowCount % INSERT_CHUNK_SIZE === 0) await flush();
      if (totalIssues > 1_000) break;
    }
    if (block) blocks.push(block);
    await flush(true);
    if (importedBarCount < 2) {
      totalIssues += 1;
      issues.push({
        row: 1,
        reason: inspection.format === "DATABENTO_CME"
          ? copy.marketReplay.validation.minimumCmeBars
          : copy.marketReplay.validation.minimumRows,
      });
    }
    if (totalIssues || !firstTime || !lastTime) throw new Error(issues[0]?.reason ?? copy.marketReplay.importError);
    await prisma.marketDatasetImport.update({
      where: { id: jobId },
      data: {
        stage: "FINALIZING", stageProcessedBytes: job.compressedBytes, stageTotalBytes: job.compressedBytes,
        stageStartedAt: new Date(), processedRows: rowCount, importedBars: importedBarCount, ...memorySnapshot(memory),
      },
    });
    await prisma.$transaction([
      prisma.marketDataset.update({
        where: { id: dataset.id },
        data: {
          status: "READY", barCount: importedBarCount, startTime: firstTime, endTime: lastTime,
          barBlockBuildCursor: importedBarCount - 1, dataVersion: { increment: 1 },
        },
      }),
      prisma.marketDatasetImport.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED", stage: "COMPLETED", processedRows: rowCount, totalRows: inspection.rowCount,
          importedBars: importedBarCount, expandedBytes: inspection.expandedBytes, totalErrors: 0, errors: "[]",
          stageProcessedBytes: job.compressedBytes, stageTotalBytes: job.compressedBytes,
          workerPid: null, ...memorySnapshot(memory),
        },
      }),
    ]);
    await rm(job.storedPath, { force: true });
  } catch (error) {
    if (datasetId) await prisma.marketDataset.deleteMany({ where: { id: datasetId, status: "IMPORTING" } });
    const fallback = error instanceof Error ? error.message : copy.marketReplay.importError;
    if (!issues.length) issues.push({ row: Math.max(1, rowCount + 1), reason: fallback });
    await prisma.marketDatasetImport.update({
      where: { id: jobId },
      data: {
        datasetId: null, status: "FAILED", workerPid: null,
        importedBars: importedBarCount, totalErrors: Math.max(totalIssues, issues.length),
        errors: JSON.stringify(issues.slice(0, 20)), ...memorySnapshot(memory),
      },
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function ensureImportRoot() {
  await mkdir(MARKET_IMPORT_ROOT, { recursive: true });
}
