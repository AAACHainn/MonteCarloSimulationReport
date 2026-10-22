import type { MarketDataset, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { AGGREGATION_RULE_VERSION, aggregateTimeChunk, aggregationFingerprint, type AggregationInput, type AggregationTail } from "./time-aggregation";

type Db = Prisma.TransactionClient | PrismaClient;
export function createAggregationGeneration(db: Db, dataset: MarketDataset, id?: string) {
  return db.marketAggregationGeneration.create({ data: {
    id, datasetId: dataset.id, ruleVersion: AGGREGATION_RULE_VERSION, historyVersion: dataset.historyVersion,
    fingerprint: aggregationFingerprint(dataset),
  } });
}

/** Caller commits the raw prefix and this checkpoint in the same bounded transaction. */
export async function writeAggregationChunk(db: Db, generationId: string, dataset: MarketDataset, bars: readonly AggregationInput[]) {
  const generation = await db.marketAggregationGeneration.findUniqueOrThrow({ where: { id: generationId } });
  const fresh = bars.filter((bar) => bar.sequence > generation.cursor);
  if (!fresh.length) return;
  if (fresh[0].sequence !== generation.cursor + 1) throw new Error("AGGREGATION_SEQUENCE_GAP");
  const result = aggregateTimeChunk(dataset, fresh, JSON.parse(generation.tailState) as AggregationTail);
  if (result.completed.length) await db.marketAggregatedBar.createMany({ data: result.completed.map((item) => ({
    ...item, generationId, bucketStart: new Date(item.bucketStart), bucketEnd: new Date(item.bucketEnd),
    firstTime: new Date(item.firstTime), lastTime: new Date(item.lastTime),
  })) });
  await db.marketAggregationGeneration.update({ where: { id: generationId }, data: { cursor: fresh.at(-1)!.sequence, tailState: JSON.stringify(result.tail) } });
}

export function generationMatches(dataset: MarketDataset, generation: { datasetId: string; ruleVersion: number; historyVersion: number; fingerprint: string; status: string; cursor: number }, allowRetired = false) {
  return generation.datasetId === dataset.id && (generation.status === "READY" || (allowRetired && generation.status === "RETIRED")) && generation.ruleVersion === AGGREGATION_RULE_VERSION
    && generation.historyVersion === dataset.historyVersion && generation.fingerprint === aggregationFingerprint(dataset)
    && generation.cursor >= dataset.barCount - 1;
}

/** Build only the appended tail, seeded with the previously checkpointed open buckets. */
export async function prepareAggregationAppend(target: MarketDataset, stagingId: string) {
  if (!target.activeAggregationId) return null;
  const base = await prisma.marketAggregationGeneration.findUnique({ where: { id: target.activeAggregationId } });
  if (!base || !generationMatches(target, base)) return null;
  return prisma.marketAggregationGeneration.create({ data: {
    datasetId: stagingId, ruleVersion: base.ruleVersion, historyVersion: base.historyVersion,
    fingerprint: base.fingerprint, cursor: base.cursor, tailState: base.tailState,
    status: `APPEND:${base.id}`,
  } });
}

/** Atomically move the already-built staging summaries along with the staged raw tail. */
export async function publishAggregationAppend(db: Db, target: MarketDataset, stagingId: string, finalSequence: number) {
  const pending = await db.marketAggregationGeneration.findFirst({ where: { datasetId: stagingId } });
  if (!pending) return;
  if (pending.status !== `APPEND:${target.activeAggregationId}` || pending.cursor !== finalSequence) throw new Error(copy.marketReplay.appendTargetChanged);
  await db.marketAggregatedBar.updateMany({ where: { generationId: pending.id }, data: { generationId: target.activeAggregationId! } });
  await db.marketAggregationGeneration.update({ where: { id: target.activeAggregationId! }, data: { cursor: pending.cursor, tailState: pending.tailState } });
}

export class AggregationNotReadyError extends Error {
  readonly code = "AGGREGATION_NOT_READY";
  constructor() { super(copy.marketReplay.aggregation.notReady); }
}

export async function activeAggregation(dataset: MarketDataset, db: Db = prisma) {
  const generation = dataset.activeAggregationId
    ? await db.marketAggregationGeneration.findUnique({ where: { id: dataset.activeAggregationId } }) : null;
  if (!generation || !generationMatches(dataset, generation, true)) throw new AggregationNotReadyError();
  return generation;
}
