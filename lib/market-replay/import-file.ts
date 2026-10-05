import { createReadStream } from "node:fs";
import { Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { createCsvColumnIndexes, databentoSourceIntervalSeconds, inspectMarketCsvHeaders, parseFiniteNumber,
  parseMarketTimestamp, readCsvValue, type CsvColumnIndexes, type CsvValues, type MarketCsvFormat, type ParsedMarketBar } from "./parse-market-bars";
import { MAX_MARKET_EXPANDED_BYTES, formatInterval } from "./types";
import { addCmeDailyVolume, buildCmeVolumeLeadMap, normalizeCmeOutrightSymbol, type CmeDailyVolumes } from "./cme-contracts";
export const INSERT_CHUNK_SIZE = 1_000;
export const PROGRESS_UPDATE_MS = 1_000;

export type BlockAccumulator = {
  startSequence: number; endSequence: number; startTime: Date; endTime: Date;
  open: number; high: number; low: number; close: number; volume: number | null; volumeCount: number; barCount: number;
};

export function addToBlock(block: BlockAccumulator | null, bar: ParsedMarketBar) {
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

export function countedCsvStream(path: string, fileName: string) {
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

export type WorkerMemory = { peakRssBytes: number };

export function memorySnapshot(memory: WorkerMemory) {
  const rss = process.memoryUsage().rss;
  memory.peakRssBytes = Math.max(memory.peakRssBytes, rss);
  return { workerRssBytes: rss, peakWorkerRssBytes: memory.peakRssBytes };
}

export function startWorkerHeartbeat(jobId: string, memory: WorkerMemory) {
  const heartbeat = setInterval(() => {
    void prisma.marketDatasetImport.updateMany({
      where: { id: jobId, status: "PROCESSING" },
      data: { ...memorySnapshot(memory) },
    }).catch(() => undefined);
  }, 10_000);
  heartbeat.unref();
  return heartbeat;
}

export function inspectHeaders(values: CsvValues) {
  const inspected = inspectMarketCsvHeaders(values);
  if (inspected.missingColumns.length) {
    throw new Error(copy.marketReplay.validation.missingColumns(inspected.missingColumns.join(", ")));
  }
  return { format: inspected.format, columns: createCsvColumnIndexes(inspected.normalizedHeaders) };
}

export async function inspectImportFile(job: { id: string; storedPath: string; fileName: string; compressedBytes: bigint }, metadata: {
  timezone: string;
  symbol: string;
  sourceIntervalSeconds: number | null;
}, memory: WorkerMemory, validateSymbols = false) {
  let rowCount = 0;
  let header: { format: MarketCsvFormat; columns: CsvColumnIndexes } | null = null;
  let lastProgressAt = 0;
  const databentoIntervals = new Set<number>();
  const intervalCounts = new Map<number, number>();
  const dailyVolumes: CmeDailyVolumes = new Map();
  let previousStandardTimestamp: number | null = null;
  let matchingCmeRows = 0;
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
        matchingCmeRows += 1;
        const timestamp = parseMarketTimestamp(readCsvValue(values, "ts_event", header.columns), metadata.timezone);
        const volume = parseFiniteNumber(readCsvValue(values, "volume", header.columns));
        if (!timestamp) throw new Error(copy.marketReplay.validation.invalidTimestamp);
        if (volume === null || volume < 0) throw new Error(copy.marketReplay.validation.invalidVolume);
        addCmeDailyVolume(dailyVolumes, timestamp, symbol, volume);
      }
    } else {
      if (validateSymbols && header.columns.symbol !== undefined) {
        const symbol = (readCsvValue(values, "symbol", header.columns) ?? "").trim().toUpperCase();
        if (symbol !== metadata.symbol.trim().toUpperCase()) throw new Error(copy.marketReplay.appendSymbolMismatch(metadata.symbol));
      }
      if (validateSymbols && header.columns.source_interval_seconds !== undefined) {
        const declared = Number(readCsvValue(values, "source_interval_seconds", header.columns));
        if (declared !== metadata.sourceIntervalSeconds) throw new Error(copy.marketReplay.validation.sourceIntervalMismatch(formatInterval(declared)));
      }
      if (metadata.sourceIntervalSeconds === null) {
        const timestamp = parseMarketTimestamp(readCsvValue(values, "timestamp", header.columns), metadata.timezone)?.getTime() ?? null;
        if (timestamp !== null && previousStandardTimestamp !== null) {
          const interval = (timestamp - previousStandardTimestamp) / 1_000;
          if (Number.isInteger(interval) && interval >= 1 && interval <= 86_400) {
            intervalCounts.set(interval, (intervalCounts.get(interval) ?? 0) + 1);
          }
        }
        if (timestamp !== null) previousStandardTimestamp = timestamp;
      }
    }
    if (rowCount % INSERT_CHUNK_SIZE === 0) await persistProgress();
  }
  if (!header) throw new Error(copy.marketReplay.validation.minimumRows);
  if (validateSymbols && header.format === "DATABENTO_CME" && !matchingCmeRows) throw new Error(copy.marketReplay.appendSymbolMismatch(metadata.symbol));
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

