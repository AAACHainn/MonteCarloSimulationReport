import { prisma } from "@/lib/db";
import type { ReplayCheckpoint, PaperTradingSession } from "@prisma/client";
import { projectionRecordId } from "./identity";
import { storageId } from "./scope";
import { orderCreateData } from "@/lib/paper-trading/persist";
import { paperStateUpdate } from "./persistence";
import type { CheckpointState } from "./checkpoint";
import { EMPTY_TRADE_STATS } from "@/lib/paper-trading/trade-stats";

const COPY_CHUNK = 512;
type CopyOptions = {
  table: string; owner: "sessionId" | "projectionId"; source: string; target: string;
  sourceProjection: string; targetProjection: string;
  where: string; values: unknown[]; identityColumns?: string[]; clampToSequence?: number;
};
// Only fixed internal table names and PRAGMA-provided column names enter SQL.
// Row ids and all user/domain values are bound parameters. Each copy is bounded.
async function copyRows(options: CopyOptions) {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${options.table}")`);
  const sourcePrefix = `projection::${options.sourceProjection}::`;
  const targetPrefix = `projection::${options.targetProjection}::`;
  const expressions = columns.map(({ name }) => {
    if (name === options.owner) return { sql: "?", values: [options.target] };
    if (options.identityColumns?.includes(name)) return {
      sql: `? || CASE WHEN substr("${name}",1,?)=? THEN substr("${name}",?) ELSE "${name}" END`,
      values: [targetPrefix, sourcePrefix.length, sourcePrefix, sourcePrefix.length + 1],
    };
    if (name === "toSequence" && options.clampToSequence !== undefined) return { sql: `MIN("toSequence",?)`, values: [options.clampToSequence] };
    return { sql: `"${name}"`, values: [] };
  });
  let cursor: bigint | number = 0;
  while (true) {
    const rows: Array<{ rowid: bigint }> = await prisma.$queryRawUnsafe<Array<{ rowid: bigint }>>(
      `SELECT rowid FROM "${options.table}" WHERE "${options.owner}"=? AND (${options.where}) AND rowid>? ORDER BY rowid LIMIT ${COPY_CHUNK}`,
      options.source, ...options.values, cursor,
    );
    if (!rows.length) return;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${options.table}" (${columns.map(({ name }) => `"${name}"`).join(",")}) SELECT ${expressions.map(({ sql }) => sql).join(",")} FROM "${options.table}" WHERE rowid IN (${rows.map(() => "?").join(",")}) AND "${options.owner}"=?`,
      ...expressions.flatMap(({ values }) => values), ...rows.map(({ rowid }) => rowid), options.source,
    );
    cursor = rows.at(-1)!.rowid;
  }
}

export async function cloneCheckpointPrefix(baseProjectionId: string, targetProjectionId: string, checkpoint: ReplayCheckpoint): Promise<PaperTradingSession | null> {
  const sourceAccount = await prisma.paperTradingSession.findUnique({ where: { projectionId: baseProjectionId } });
  const state = JSON.parse(checkpoint.state) as CheckpointState;
  const base = { sourceProjection: baseProjectionId, targetProjection: targetProjectionId };
  const prefix = { source: baseProjectionId, target: targetProjectionId, owner: "projectionId" as const, ...base };
  const boundary = `(sourceSequence<? OR (sourceSequence=? AND commandOrdinal<=?))`;
  await copyRows({ ...prefix, table: "ReplayCheckpoint", where: boundary,
    values: [checkpoint.sourceSequence, checkpoint.sourceSequence, checkpoint.commandOrdinal], identityColumns: ["id"] });
  await copyRows({ ...prefix, table: "ReplayContextRun", where: "fromSequence<=?", values: [checkpoint.sourceSequence], identityColumns: ["id"], clampToSequence: checkpoint.sourceSequence });
  await copyRows({ ...prefix, table: "ReplayProjectionCommand",
    where: `commandId IN (SELECT id FROM ReplayCommand WHERE sourceSequence<? OR (sourceSequence=? AND ordinal<=?))`,
    values: [checkpoint.sourceSequence, checkpoint.sourceSequence, checkpoint.commandOrdinal] });
  if (!state.account || !sourceAccount) return null;
  const config = { initialCapital: state.account.initialCapital, currency: state.account.currency, commissionBps: state.account.commissionBps, slippageBps: state.account.slippageBps };
  let account = await prisma.paperTradingSession.create({ data: {
    id: storageId(state.account.id), datasetId: sourceAccount.datasetId, projectionId: targetProjectionId,
    journalSessionId: sourceAccount.journalSessionId, ...config, ...paperStateUpdate(state.account),
    ...(state.stats ?? EMPTY_TRADE_STATS), equitySampleStride: state.equitySampleStride ?? sourceAccount.equitySampleStride,
  } });
  const owned = { source: sourceAccount.id, target: account.id, owner: "sessionId" as const, ...base };
  const sequence = checkpoint.sourceSequence;
  await copyRows({ ...owned, table: "PaperOrder", where: `filledSequence<=? OR
    (status IN ('CANCELLED','REJECTED') AND (createdSequence<? OR (createdSequence=? AND id IN (
      SELECT ? || json_extract(c.payload,'$.order.id') FROM ReplayCommand c
      JOIN ReplayProjectionCommand pc ON pc.commandId=c.id
      WHERE pc.projectionId=? AND c.type='ORDER_CREATE' AND c.sourceSequence=? AND c.ordinal<=?
    )))) OR (isProtective=1 AND createdSequence=? AND status!='PENDING')`,
    values: [sequence, sequence, sequence, `projection::${baseProjectionId}::`, baseProjectionId, sequence, checkpoint.commandOrdinal, sequence], identityColumns: ["id"] });
  for (const order of state.activeOrders ?? []) {
    const data = orderCreateData(account.id, order);
    await prisma.paperOrder.upsert({ where: { id: data.id }, create: data, update: data });
  }
  await copyRows({ ...owned, table: "PaperFill", where: "sequence<=?", values: [sequence], identityColumns: ["id", "orderId"] });
  await copyRows({ ...owned, table: "PaperTrade", where: "closedSequence<=?", values: [sequence], identityColumns: ["id"] });
  if (state.activeTrade) {
    const trade = state.activeTrade;
    await prisma.paperTrade.create({ data: { ...trade, id: storageId(trade.id), sessionId: account.id,
      openedAt: new Date(trade.openedAt), closedAt: trade.closedAt ? new Date(trade.closedAt) : null } });
  }
  if (state.lots?.length) await prisma.paperPositionLot.createMany({ data: state.lots.map((lot) => ({
    ...lot, discipline: lot.discipline ? JSON.stringify(lot.discipline) : null, id: storageId(lot.id), entryFillId: storageId(lot.entryFillId), sessionId: account.id, openedAt: new Date(lot.openedAt),
  })) });
  await copyRows({ ...owned, table: "PaperEquityPoint", where: "sequence<=?", values: [sequence] });
  await copyRows({ ...prefix, table: "ReplayJournalEntry", where: "closedSequence<=?", values: [sequence], identityColumns: ["id", "lotId"] });
  // Copy reason links without materializing the full journal in JS.
  const sourcePrefix = `projection::${baseProjectionId}::`;
  const targetPrefix = `projection::${targetProjectionId}::`;
  await prisma.$executeRawUnsafe(`INSERT OR IGNORE INTO _ReplayJournalTradeReasons (A,B)
    SELECT ? || CASE WHEN substr(r.A,1,?)=? THEN substr(r.A,?) ELSE r.A END,r.B
    FROM _ReplayJournalTradeReasons r JOIN ReplayJournalEntry e ON e.id=r.A WHERE e.projectionId=? AND e.closedSequence<=?`,
  targetPrefix, sourcePrefix.length, sourcePrefix, sourcePrefix.length + 1, baseProjectionId, sequence);
  account = await prisma.paperTradingSession.findUniqueOrThrow({ where: { id: projectionRecordId(targetProjectionId, state.account.id) } });
  return account;
}
