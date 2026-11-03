import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { isPriceOnTick } from "@/lib/market-replay/price-ticks";
import { orderCreateData } from "@/lib/paper-trading/persist";
import { isValidProtectivePrice, nextPartialExitNumber } from "@/lib/paper-trading/protective-orders";
import { getPaperSessionSnapshot, serializePaperOrder } from "@/lib/paper-trading/serialize";
import type { PaperOrderData } from "@/lib/paper-trading/types";
import { assertPropTradingAvailable, observePropOperation } from "@/lib/prop-practice/service";
import { recordReplayCommand } from "@/lib/replay-sessions/service";
import { accountWhere, assertReplayWritable, markReplayMutation, progressWhere, storageId, withReplaySessionRoute } from "@/lib/replay-sessions/scope";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { MAX_ACTIVE_PROTECTIVE_ORDERS, paperPartialExitSchema } from "@/lib/validations";

async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = paperPartialExitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: copy.paperTrading.invalidPartialExit }, { status: 400 });
  const result = await sqliteWriteTransaction(prisma, async (tx) => {
    await assertReplayWritable(tx);
    await assertPropTradingAvailable(tx);
    const session = await tx.paperTradingSession.findFirst({ where: accountWhere(id) });
    if (!session) return { status: 404, error: copy.paperTrading.sessionNotFound };
    if (session.version !== parsed.data.expectedVersion) return { status: 409, error: copy.paperTrading.conflict };
    const [source, progress, dataset, pendingCount] = await Promise.all([
      tx.paperOrder.findFirst({ where: { id: storageId(parsed.data.sourceOrderId), sessionId: session.id, status: "PENDING", isProtective: true } }),
      tx.replayProgress.findFirst({ where: progressWhere(id) }),
      tx.marketDataset.findUnique({ where: { id }, select: { priceTickSize: true, barCount: true } }),
      tx.paperOrder.count({ where: { sessionId: session.id, status: "PENDING", isProtective: true } }),
    ]);
    if (!source || !source.reduceOnly) return { status: 404, error: copy.paperTrading.orderNotFound };
    if (!progress || !dataset || session.lastProcessedSequence !== progress.currentSequence) return { status: 409, error: copy.paperTrading.conflict };
    if (progress.currentSequence >= dataset.barCount - 1) return { status: 400, error: copy.paperTrading.noNextBar };
    if (pendingCount >= MAX_ACTIVE_PROTECTIVE_ORDERS) return { status: 400, error: copy.paperTrading.protectiveOrderLimit(MAX_ACTIVE_PROTECTIVE_ORDERS) };
    if (parsed.data.quantity <= 1e-12 || parsed.data.quantity > Math.abs(session.netQuantity)) return { status: 400, error: copy.paperTrading.exitQuantityExceeded };
    if (!isPriceOnTick(parsed.data.price, dataset.priceTickSize)) return { status: 400, error: copy.paperTrading.priceNotOnTick };
    const bar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: id, sequence: progress.currentSequence } } });
    if (!bar || source.side !== (session.netQuantity > 0 ? "SELL" : "BUY")
      || !isValidProtectivePrice(session.netQuantity, source.type as PaperOrderData["type"], parsed.data.price, bar.close)) {
      return { status: 400, error: copy.paperTrading.invalidBracket };
    }
    // Entries and reversals start a fresh directional position. Partial exits
    // can only be added after that source bar has finished, so earlier positions'
    // exit orders always have a lower createdSequence, including same-bar reversals.
    const positionStart = await tx.paperFill.findFirst({
      where: { sessionId: session.id, reason: { in: ["ENTRY", "REVERSE"] } },
      orderBy: { sequence: "desc" }, select: { sequence: true },
    });
    if (!positionStart) return { status: 409, error: copy.paperTrading.conflict };
    const siblings = await tx.paperOrder.findMany({
      where: { sessionId: session.id, isProtective: true, type: source.type,
        createdSequence: { gte: positionStart.sequence } },
      select: { id: true },
    });
    const kind = source.type === "STOP" ? "sl" : "tp";
    const order: PaperOrderData = {
      id: "partial_" + kind + "_" + nextPartialExitNumber(siblings) + "_" + randomUUID(),
      side: source.side as PaperOrderData["side"], type: source.type as PaperOrderData["type"], status: "PENDING",
      price: parsed.data.price, quantity: parsed.data.quantity, riskAmount: null, stopLoss: null, takeProfit: null,
      reduceOnly: true, isProtective: true, ocoGroupId: null, parentOrderId: source.parentOrderId,
      createdSequence: progress.currentSequence, activeFromSequence: progress.currentSequence + 1,
      filledSequence: null, filledAt: null, filledPrice: null, cancelReason: null,
    };
    const saved = await tx.paperOrder.create({ data: orderCreateData(session.id, order) });
    await tx.paperTradingSession.update({ where: { id: session.id }, data: { version: { increment: 1 } } });
    await recordReplayCommand(tx, progress.currentSequence, "ORDER_CREATE", { order: serializePaperOrder(saved) });
    await observePropOperation(tx, false);
    await markReplayMutation(tx);
    return { status: 201, error: null };
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) }, { status: 201 });
}

export const POST = withReplaySessionRoute(handlePOST, { write: true, annotation: false });
