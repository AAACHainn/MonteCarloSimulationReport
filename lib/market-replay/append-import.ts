import { rm, stat } from "node:fs/promises";
import { parse } from "csv-parse";
import type { MarketDatasetImport } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { marketDatasetSchema } from "@/lib/validations";
import { MARKET_BAR_BLOCK_SIZE, MARKET_BAR_BLOCK_SIZES, MAX_MARKET_BARS, formatInterval } from "./types";
import { parseMarketCsvRow, parseMarketTimestamp, readCsvValue, type CsvValues, type ParsedMarketBar, type MarketCsvIssue } from "./parse-market-bars";
import { addToBlock, countedCsvStream, inspectHeaders, inspectImportFile, memorySnapshot, startWorkerHeartbeat,
  INSERT_CHUNK_SIZE, type BlockAccumulator } from "./import-file";
import type { AppendImportMetadata, AppendPreview } from "./append-import-types";

/** Publish the staged tail in one transaction; existing source sequences and replay state stay stable. */
async function publishAppend(job: MarketDatasetImport, metadata: AppendImportMetadata, stagingId: string) {
  const preview = metadata.preview!;
  const snapshot = metadata.snapshot!;
  const finalCount = snapshot.barCount + preview.importedBars;
  await prisma.$transaction(async (tx) => {
    const target = await tx.marketDataset.findUnique({ where: { id: metadata.targetDatasetId } });
    if (!target || target.status !== "READY" || target.barCount !== snapshot.barCount
      || target.endTime.toISOString() !== snapshot.endTime || target.dataVersion !== snapshot.dataVersion
      || target.sourceIntervalSeconds !== metadata.sourceIntervalSeconds || target.symbol.toUpperCase() !== metadata.symbol.toUpperCase()) {
      throw new Error(copy.marketReplay.appendTargetChanged);
    }
    if (preview.importedBars) {
      await tx.marketBar.updateMany({ where: { datasetId: stagingId }, data: { datasetId: target.id } });
      for (const blockSize of MARKET_BAR_BLOCK_SIZES) {
        const prefixStart = Math.floor(snapshot.barCount / blockSize) * blockSize;
        await tx.marketBarBlock.deleteMany({ where: { datasetId: target.id, blockSize, startSequence: { gte: prefixStart } } });
        const state = await tx.marketBarBlockBuildState.findUnique({ where: { datasetId_blockSize: { datasetId: target.id, blockSize } } });
        const oldCursor = Math.max(state?.cursor ?? -1, blockSize === MARKET_BAR_BLOCK_SIZE ? target.barBlockBuildCursor : -1);
        const cursor = oldCursor >= snapshot.barCount - 1 ? finalCount - 1 : oldCursor;
        await tx.marketBarBlockBuildState.upsert({
          where: { datasetId_blockSize: { datasetId: target.id, blockSize } },
          create: { datasetId: target.id, blockSize, cursor }, update: { cursor },
        });
      }
      await tx.marketBarBlock.updateMany({ where: { datasetId: stagingId }, data: { datasetId: target.id } });
      await tx.marketDataset.update({ where: { id: target.id }, data: {
        barCount: finalCount, endTime: new Date(preview.lastTime!), dataVersion: { increment: 1 },
        barBlockBuildCursor: target.barBlockBuildCursor >= snapshot.barCount - 1 ? finalCount - 1 : target.barBlockBuildCursor,
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
    const accumulators = new Map<number, BlockAccumulator | null>();
    // Only read each old partial block (at most 4,095 bars), not the full history.
    for (const size of MARKET_BAR_BLOCK_SIZES) {
      const start = Math.floor(target.barCount / size) * size;
      const bars = start < target.barCount ? await prisma.marketBar.findMany({
        where: { datasetId: target.id, sequence: { gte: start, lt: target.barCount } }, orderBy: { sequence: "asc" },
      }) : [];
      let block: BlockAccumulator | null = null;
      for (const bar of bars) block = addToBlock(block, bar);
      accumulators.set(size, block);
    }
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
      const blocks: Array<BlockAccumulator & { blockSize: number; datasetId: string }> = [];
      for (const [time, { rowNumber, ...bar }] of unique) {
        if (seen.has(time)) { preview.duplicateRows += 1; continue; }
        if (time <= previousTime) throw new Error(copy.marketReplay.errorRow(rowNumber, copy.marketReplay.validation.invalidOrder));
        if (target.barCount + preview.importedBars >= MAX_MARKET_BARS) throw new Error(copy.marketReplay.validation.maximumRows(MAX_MARKET_BARS));
        const missingBars = Math.max(0, Math.ceil((time - previousTime) / (metadata.sourceIntervalSeconds * 1_000)) - 1);
        if (missingBars) {
          preview.gapCount += 1; preview.missingBars += missingBars;
          if (preview.gaps.length < 10) preview.gaps.push({ after: new Date(previousTime).toISOString(), before: bar.timestamp.toISOString(), missingBars });
        }
        bar.sequence = target.barCount + preview.importedBars;
        bars.push({ ...bar, datasetId: staging.id });
        preview.importedBars += 1; previousTime = time;
        preview.firstTime ??= bar.timestamp.toISOString(); preview.lastTime = bar.timestamp.toISOString();
        for (const size of MARKET_BAR_BLOCK_SIZES) {
          const block = addToBlock(accumulators.get(size) ?? null, bar);
          if (block.barCount === size) { blocks.push({ ...block, blockSize: size, datasetId: staging.id }); accumulators.set(size, null); }
          else accumulators.set(size, block);
        }
      }
      if (bars.length) await prisma.marketBar.createMany({ data: bars });
      if (blocks.length) await prisma.marketBarBlock.createMany({ data: blocks });
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
    const partials = [...accumulators].flatMap(([blockSize, block]) => block && preview.importedBars ? [{ ...block, blockSize, datasetId: staging.id }] : []);
    if (partials.length) await prisma.marketBarBlock.createMany({ data: partials });
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
