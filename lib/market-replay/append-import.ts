import { rm, stat } from "node:fs/promises";
import { parse } from "csv-parse";
import type { MarketDatasetImport } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { marketDatasetSchema } from "@/lib/validations";
import { MAX_MARKET_BARS, formatInterval } from "./types";
import { parseMarketCsvRow, parseMarketTimestamp, readCsvValue, type CsvValues, type ParsedMarketBar, type MarketCsvIssue } from "./parse-market-bars";
import { countedCsvStream, inspectHeaders, inspectImportFile, memorySnapshot, startWorkerHeartbeat,
  INSERT_CHUNK_SIZE } from "./import-file";
import { prepareAggregationAppend, publishAggregationAppend, writeAggregationChunk } from "./aggregation-storage";
import type { AppendImportMetadata, AppendPreview } from "./append-import-types";
import { acquireDatasetLease, releaseDatasetLease, LEASE_MS } from "@/lib/market-sync/lease";

/** Publish the staged tail in one transaction; existing source sequences and replay state stay stable. */
async function publishAppend(job: MarketDatasetImport, metadata: AppendImportMetadata, stagingId: string) {
  const preview = metadata.preview!;
  const snapshot = metadata.snapshot!;
  const finalCount = snapshot.barCount + preview.importedBars;
  await prisma.$transaction(async (tx) => {
    const lease = await tx.marketDatasetUpdateLease.findUnique({ where: { datasetId: metadata.targetDatasetId } });
    if (!lease || lease.owner !== `import_${job.id}` || lease.expiresAt <= new Date()) throw new Error(copy.marketSync.busy);
    const target = await tx.marketDataset.findUnique({ where: { id: metadata.targetDatasetId } });
    if (!target || target.status !== "READY" || target.barCount !== snapshot.barCount
      || target.endTime.toISOString() !== snapshot.endTime || target.dataVersion !== snapshot.dataVersion
      || target.sourceIntervalSeconds !== metadata.sourceIntervalSeconds || target.symbol.toUpperCase() !== metadata.symbol.toUpperCase()) {
      throw new Error(copy.marketReplay.appendTargetChanged);
    }
    if (preview.importedBars) {
      await tx.marketBar.updateMany({ where: { datasetId: stagingId }, data: { datasetId: target.id } });
      await publishAggregationAppend(tx, target, stagingId, finalCount - 1);
      await tx.marketDataset.update({ where: { id: target.id }, data: {
        barCount: finalCount, endTime: new Date(preview.lastTime!), dataVersion: { increment: 1 },
      } });
    }
    await tx.marketDatasetImport.update({ where: { id: job.id }, data: {
      datasetId: target.id, status: "COMPLETED", stage: "COMPLETED", workerPid: null,
      stageProcessedBytes: job.compressedBytes, totalErrors: 0, errors: "[]", metadata: JSON.stringify(metadata),
    } });
    await tx.marketDataset.delete({ where: { id: stagingId } });
  }, { maxWait: 30_000, timeout: 120_000 });
  // A file cleanup failure must never turn an already committed append into a failed/retryable job.
  if (job.storedPath) await rm(job.storedPath, { force: true }).catch(() => undefined);
}

export async function processAppendImportJob(job: MarketDatasetImport) {
  const metadata = JSON.parse(job.metadata) as AppendImportMetadata;
  const owner = `import_${job.id}`;
  await acquireDatasetLease(prisma, metadata.targetDatasetId, owner);
  const timer = setInterval(() => {
    void prisma.marketDatasetUpdateLease.updateMany({ where: { datasetId: metadata.targetDatasetId, owner }, data: { expiresAt: new Date(Date.now() + LEASE_MS) } }).catch(() => undefined);
  }, 20000);
  try { await processLockedAppendImportJob(job); }
  finally { clearInterval(timer); await releaseDatasetLease(metadata.targetDatasetId, owner); }
}

async function processLockedAppendImportJob(job: MarketDatasetImport) {
  const metadata = JSON.parse(job.metadata) as AppendImportMetadata;
  marketDatasetSchema.parse(metadata);
  const file = await stat(job.storedPath!);
  if (!file.isFile()) throw new Error(copy.marketReplay.importError);
  const confirmed = metadata.confirmed === true && job.stage === "FINALIZING" && metadata.preview && metadata.snapshot && job.datasetId;
  const claimed = await prisma.marketDatasetImport.updateMany({
    where: { id: job.id, status: { in: ["QUEUED", "UPLOADED", "FAILED", "INTERRUPTED"] } },
    data: { status: "PROCESSING", stage: confirmed ? "FINALIZING" : "ANALYZING", stageStartedAt: new Date(),
      workerPid: process.pid, totalErrors: 0, errors: "[]" },
  });
  if (claimed.count !== 1) throw new Error(copy.marketReplay.importAlreadyRunning);
  const memory = { peakRssBytes: process.memoryUsage().rss };
  const heartbeat = startWorkerHeartbeat(job.id, memory);
  let stagingId = job.datasetId;
  const issues: MarketCsvIssue[] = [];
  let totalErrors = 0;
  try {
    if (confirmed) {
      await publishAppend(job, metadata, stagingId!);
      return;
    }
    if (stagingId) await prisma.marketDataset.deleteMany({ where: { id: stagingId, status: "IMPORTING" } });
    stagingId = null;
    const target = await prisma.marketDataset.findUnique({ where: { id: metadata.targetDatasetId } });
    if (!target || target.status !== "READY") throw new Error(copy.marketReplay.datasetNotFound);
    if (target.symbol.trim().toUpperCase() !== metadata.symbol.trim().toUpperCase()) throw new Error(copy.marketReplay.appendSymbolMismatch(target.symbol));
    if (target.sourceIntervalSeconds !== metadata.sourceIntervalSeconds || target.timezone !== metadata.timezone
      || target.sessionMode !== metadata.sessionMode || target.sessionOpenMinute !== (metadata.sessionOpenMinute ?? null)
      || target.sessionCloseMinute !== (metadata.sessionCloseMinute ?? null) || target.tradingWeekdays !== metadata.tradingWeekdays.join(",")) {
      throw new Error(copy.marketReplay.appendTargetChanged);
    }
    metadata.snapshot = { barCount: target.barCount, endTime: target.endTime.toISOString(), dataVersion: target.dataVersion };
    delete metadata.preview; delete metadata.confirmed;
    await prisma.marketDatasetImport.update({ where: { id: job.id }, data: {
      datasetId: null, metadata: JSON.stringify(metadata), processedRows: 0, importedBars: 0, totalRows: 0,
      stageProcessedBytes: 0, stageTotalBytes: job.compressedBytes, ...memorySnapshot(memory),
    } });
    const inspection = await inspectImportFile({ ...job, storedPath: job.storedPath! }, metadata, memory, true);
    if (inspection.format === "DATABENTO_CME" && inspection.detectedSourceIntervalSeconds !== metadata.sourceIntervalSeconds) {
      throw new Error(copy.marketReplay.validation.sourceIntervalMismatch(formatInterval(inspection.detectedSourceIntervalSeconds!)));
    }
    const staging = await prisma.marketDataset.create({ data: {
      name: metadata.name, description: metadata.description, symbol: metadata.symbol, timeframe: metadata.timeframe,
      timezone: metadata.timezone, status: "IMPORTING", sourceIntervalSeconds: metadata.sourceIntervalSeconds,
        barEmissionMode: target.barEmissionMode,
      priceTickSize: metadata.priceTickSize, sessionMode: metadata.sessionMode,
      sessionOpenMinute: metadata.sessionOpenMinute, sessionCloseMinute: metadata.sessionCloseMinute,
      tradingWeekdays: metadata.tradingWeekdays.join(","), barCount: 0, startTime: new Date(0), endTime: new Date(0),
    } });
    stagingId = staging.id;
    await prisma.marketDatasetImport.update({ where: { id: job.id }, data: {
      datasetId: stagingId, totalRows: inspection.rowCount, expandedBytes: inspection.expandedBytes,
      processedRows: 0, stage: "IMPORTING", stageProcessedBytes: 0, stageStartedAt: new Date(),
    } });
    const preview: AppendPreview = { importedBars: 0, overlappingRows: 0, duplicateRows: 0, skippedRows: 0,
      gapCount: 0, missingBars: 0, gaps: [], firstTime: null, lastTime: null };
    const aggregation = await prepareAggregationAppend(target, staging.id);
    const source = countedCsvStream(job.storedPath!, job.fileName);
    const parser = source.stream.pipe(parse({ bom: true, trim: true, skip_empty_lines: true }));
    let header: ReturnType<typeof inspectHeaders> | null = null;
    let rows = 0;
    let previousTime = target.endTime.getTime();
    let pending: Array<ParsedMarketBar & { rowNumber: number }> = [];
    let lastProgressAt = 0;
    const flush = async (force = false) => {
      const unique = new Map<number, typeof pending[number]>();
      for (const bar of pending) {
        const time = bar.timestamp.getTime();
        if (unique.has(time)) preview.duplicateRows += 1;
        else unique.set(time, bar);
      }
      const alreadyStaged = unique.size ? await prisma.marketBar.findMany({
        where: { datasetId: staging.id, timestamp: { in: [...unique.values()].map((bar) => bar.timestamp) } }, select: { timestamp: true },
      }) : [];
      const seen = new Set(alreadyStaged.map((bar) => bar.timestamp.getTime()));
      const bars: Array<ParsedMarketBar & { datasetId: string }> = [];
      for (const [time, { rowNumber, ...bar }] of unique) {
        if (seen.has(time)) { preview.duplicateRows += 1; continue; }
        if (time <= previousTime) throw new Error(copy.marketReplay.errorRow(rowNumber, copy.marketReplay.validation.invalidOrder));
        if (target.barCount + preview.importedBars >= MAX_MARKET_BARS) throw new Error(copy.marketReplay.validation.maximumRows(MAX_MARKET_BARS));
        const missingBars = Math.max(0, Math.ceil((time - previousTime) / (metadata.sourceIntervalSeconds * 1_000)) - 1);
          if (missingBars && target.barEmissionMode !== "TRADE_DRIVEN") {
          preview.gapCount += 1; preview.missingBars += missingBars;
          if (preview.gaps.length < 10) preview.gaps.push({ after: new Date(previousTime).toISOString(), before: bar.timestamp.toISOString(), missingBars });
        }
        bar.sequence = target.barCount + preview.importedBars;
        bars.push({ ...bar, datasetId: staging.id });
        preview.importedBars += 1; previousTime = time;
        preview.firstTime ??= bar.timestamp.toISOString(); preview.lastTime = bar.timestamp.toISOString();

      }
      if (bars.length) await prisma.$transaction(async (tx) => {
        await tx.marketBar.createMany({ data: bars });
        if (aggregation) await writeAggregationChunk(tx, aggregation.id, target, bars);
      }, { maxWait: 30000, timeout: 30000 });
      pending = [];
      if (force || Date.now() - lastProgressAt >= 1_000) {
        lastProgressAt = Date.now();
        await prisma.marketDatasetImport.update({ where: { id: job.id }, data: {
          processedRows: rows, importedBars: preview.importedBars, stageProcessedBytes: source.rawBytes(), ...memorySnapshot(memory),
        } });
      }
    };
    for await (const values of parser as AsyncIterable<CsvValues>) {
      if (!header) { header = inspectHeaders(values); continue; }
      const rowNumber = rows + 2;
      rows += 1;
      const time = parseMarketTimestamp(readCsvValue(values, header.format === "DATABENTO_CME" ? "ts_event" : "timestamp", header.columns), metadata.timezone);
      if (time && time <= target.endTime) preview.overlappingRows += 1;
      else {
        const result = parseMarketCsvRow({ row: values, columnIndexes: header.columns, rowNumber, sequence: 0,
          timezone: metadata.timezone, format: header.format, options: {
            sourceIntervalSeconds: metadata.sourceIntervalSeconds,
            session: { mode: metadata.sessionMode, timezone: metadata.timezone, openMinute: metadata.sessionOpenMinute ?? null,
              closeMinute: metadata.sessionCloseMinute ?? null, weekdays: metadata.tradingWeekdays },
            cmeRootSymbol: metadata.symbol, cmeLeadByDate: inspection.cmeLeadByDate,
          },
        });
        if (result.skipped) preview.skippedRows += 1;
        else if (result.issues.length) {
          totalErrors += result.issues.length;
          issues.push(...result.issues.slice(0, Math.max(0, 20 - issues.length)));
        } else if (result.bar) pending.push({ ...result.bar, rowNumber });
      }
      if (rows % INSERT_CHUNK_SIZE === 0) await flush();
      if (totalErrors > 1_000) break;
    }
    await flush(true);
    if (totalErrors) throw new Error(issues[0]?.reason ?? copy.marketReplay.importError);
    metadata.preview = preview;
    await prisma.marketDatasetImport.update({ where: { id: job.id }, data: {
      metadata: JSON.stringify(metadata), status: preview.gapCount ? "AWAITING_CONFIRMATION" : "PROCESSING",
      stage: preview.gapCount ? "AWAITING_CONFIRMATION" : "FINALIZING", stageStartedAt: new Date(),
      workerPid: preview.gapCount ? null : process.pid, ...memorySnapshot(memory),
    } });
    if (!preview.gapCount) await publishAppend(job, metadata, staging.id);
  } catch (error) {
    if (stagingId) await prisma.marketDataset.deleteMany({ where: { id: stagingId, status: "IMPORTING" } }).catch(() => undefined);
    delete metadata.confirmed;
    await prisma.marketDatasetImport.update({ where: { id: job.id }, data: {
      datasetId: null, status: "FAILED", workerPid: null, metadata: JSON.stringify(metadata),
      errors: JSON.stringify(issues.length ? issues : [{ row: 1, reason: error instanceof Error ? error.message : copy.marketReplay.importError }]),
      totalErrors: totalErrors || 1, ...memorySnapshot(memory),
    } });
    throw error;
  } finally { clearInterval(heartbeat); }
}
