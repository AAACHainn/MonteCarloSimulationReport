import type { MarketBar } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { aggregateMarketBars, getAggregationBucket } from "@/lib/market-replay/aggregation";
import { datasetSession, datasetSourceInterval, serializeSourceBar } from "@/lib/market-replay/dataset";
import { MAX_DISPLAY_ADVANCE_SOURCE_BARS, isValidDisplayInterval } from "@/lib/market-replay/types";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { getPaperSessionSnapshot, serializePaperOrder, serializePaperSession } from "@/lib/paper-trading/serialize";
import type { PaperEquityPointData, PaperFillData } from "@/lib/paper-trading/types";
import { paperAdvanceSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = paperAdvanceSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const outcome = await prisma.$transaction(async (tx) => {
    const [dataset, progress, session] = await Promise.all([
      tx.marketDataset.findUnique({ where: { id } }),
      tx.replayProgress.findUnique({ where: { datasetId: id } }),
      tx.paperTradingSession.findUnique({ where: { datasetId: id } }),
    ]);
    if (!dataset || !progress) return { status: 404, error: copy.marketReplay.datasetNotFound } as const;
    if (progress.currentSequence !== parsed.data.expectedCurrentSequence) return { status: 409, error: copy.paperTrading.conflict } as const;
    if (progress.currentSequence >= dataset.barCount - 1) return { status: 400, error: copy.paperTrading.noNextBar } as const;
    let targetSequence = Math.min(dataset.barCount - 1, progress.currentSequence + parsed.data.count);
    let completedDisplayBucketStart: string | null = null;
    let aggregationStart: Date | null = null;
    let prefetchedBars: MarketBar[] | null = null;
    if (parsed.data.displayIntervalSeconds !== undefined) {
      const sourceSeconds = datasetSourceInterval(dataset);
      if (!sourceSeconds || !isValidDisplayInterval(sourceSeconds, parsed.data.displayIntervalSeconds)) {
        return { status: 400, error: copy.marketReplay.invalidDisplayInterval } as const;
      }
      const multiplier = parsed.data.displayIntervalSeconds / sourceSeconds;
      if (parsed.data.count > 1) {
        const displayCount = Math.min(parsed.data.count, Math.max(1, Math.floor(MAX_DISPLAY_ADVANCE_SOURCE_BARS / multiplier)));
        const candidates = await tx.marketBar.findMany({
          where: { datasetId: id, sequence: { gt: progress.currentSequence } },
          orderBy: { sequence: "asc" }, take: multiplier * displayCount,
        });
        if (!candidates.length) return { status: 400, error: copy.paperTrading.noNextBar } as const;
        const buckets = aggregateMarketBars({
          bars: candidates.map(serializeSourceBar), sourceSeconds, displaySeconds: parsed.data.displayIntervalSeconds,
          session: datasetSession(dataset), currentSequence: candidates.at(-1)!.sequence, finalSequence: dataset.barCount - 1,
        });
        const target = buckets[Math.min(displayCount, buckets.length) - 1];
        if (!target) return { status: 400, error: copy.marketReplay.invalidDisplayInterval } as const;
        targetSequence = target.lastSequence;
        aggregationStart = new Date(buckets[0].timestamp);
        completedDisplayBucketStart = target.timestamp;
        prefetchedBars = candidates.filter((bar) => bar.sequence <= targetSequence);
      } else {
        const nextBar = await tx.marketBar.findUnique({
          where: { datasetId_sequence: { datasetId: id, sequence: progress.currentSequence + 1 } },
        });
        if (!nextBar) return { status: 400, error: copy.paperTrading.noNextBar } as const;
        const sessionConfig = datasetSession(dataset);
        const targetBucket = getAggregationBucket(nextBar.timestamp.getTime(), sourceSeconds, parsed.data.displayIntervalSeconds, sessionConfig);
        if (!targetBucket) return { status: 400, error: copy.marketReplay.invalidDisplayInterval } as const;
        const targetBar = await tx.marketBar.findFirst({
          where: {
            datasetId: id,
            timestamp: { gte: new Date(targetBucket.start), lt: new Date(targetBucket.end) },
          },
          orderBy: { timestamp: "desc" },
        });
        if (!targetBar) return { status: 404, error: copy.marketReplay.loadError } as const;
        targetSequence = targetBar.sequence;
        aggregationStart = new Date(targetBucket.start);
        completedDisplayBucketStart = aggregationStart.toISOString();
      }
    }
    const dbBars = prefetchedBars ?? await tx.marketBar.findMany({
      where: { datasetId: id, sequence: { gt: progress.currentSequence, lte: targetSequence } },
      orderBy: { sequence: "asc" },
    });
    if (dbBars.length !== targetSequence - progress.currentSequence) return { status: 404, error: copy.marketReplay.loadError } as const;

    // Return only the affected display bucket. Include its already-revealed prefix so the
    // client can replace a forming candle without double-counting volume or exposing future bars.
    const prefix = aggregationStart && dbBars[0].timestamp > aggregationStart
      ? await tx.marketBar.findMany({
        where: { datasetId: id, timestamp: { gte: aggregationStart, lt: dbBars[0].timestamp }, sequence: { lte: progress.currentSequence } },
        orderBy: { sequence: "asc" },
      }) : [];
    const aggregatedBars = parsed.data.displayIntervalSeconds === undefined ? [] : aggregateMarketBars({
      bars: [...prefix, ...dbBars].map(serializeSourceBar),
      sourceSeconds: datasetSourceInterval(dataset)!, displaySeconds: parsed.data.displayIntervalSeconds,
      session: datasetSession(dataset), currentSequence: targetSequence, finalSequence: dataset.barCount - 1,
    }).map((bar) => ({ ...bar, status: bar.sourceCount === bar.expectedCount ? "COMPLETE" as const : "INCOMPLETE" as const }));
    const lastSourceBar = serializeSourceBar(dbBars.at(-1)!);

    if (!session) {
      await tx.replayProgress.update({ where: { datasetId: id }, data: { currentSequence: targetSequence } });
      return { status: 200, error: null, currentSequence: targetSequence, paper: false, bars: dbBars, completedDisplayBucketStart, aggregatedBars, lastSourceBar } as const;
    }
    if (session.version !== parsed.data.expectedVersion || session.lastProcessedSequence !== progress.currentSequence) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }

    let state = serializePaperSession(session);
    let orders = (await tx.paperOrder.findMany({ where: { sessionId: session.id, status: "PENDING" } })).map(serializePaperOrder);
    const originalOrders = new Map(orders.map((order) => [order.id, JSON.stringify(order)]));
    const fills: PaperFillData[] = [];
    const equityPoints: PaperEquityPointData[] = [];
    for (const bar of dbBars) {
      const result = advancePaperTrading({
        state, orders, bar: serializeSourceBar(bar), makeId: randomUUID,
      });
      state = result.state;
      orders = result.orders;
      fills.push(...result.fills);
      const shouldSample = result.fills.length > 0
        || bar.sequence === dataset.barCount - 1
        || bar.sequence % session.equitySampleStride === 0;
      if (shouldSample) equityPoints.push(result.equityPoint);
    }

    await tx.paperTradingSession.update({
      where: { id: session.id },
      data: {
        lastProcessedSequence: state.lastProcessedSequence, netQuantity: state.netQuantity,
        averageEntryPrice: state.averageEntryPrice, realizedPnl: state.realizedPnl,
        totalFees: state.totalFees, totalSlippage: state.totalSlippage,
        peakEquity: state.peakEquity, maxDrawdown: state.maxDrawdown, version: state.version,
      },
    });
    for (const order of orders) {
      if (originalOrders.get(order.id) === JSON.stringify(order)) continue;
      await tx.paperOrder.upsert({
        where: { id: order.id },
        create: {
          id: order.id, sessionId: session.id, side: order.side, type: order.type, status: order.status,
          quantity: order.quantity, riskAmount: order.riskAmount, price: order.price, stopLoss: order.stopLoss, takeProfit: order.takeProfit,
          reduceOnly: order.reduceOnly, isProtective: order.isProtective, ocoGroupId: order.ocoGroupId,
          createdSequence: order.createdSequence, activeFromSequence: order.activeFromSequence,
          filledSequence: order.filledSequence, filledAt: order.filledAt ? new Date(order.filledAt) : null,
          filledPrice: order.filledPrice, cancelReason: order.cancelReason,
        },
        update: {
          status: order.status, quantity: order.quantity, riskAmount: order.riskAmount, price: order.price,
          activeFromSequence: order.activeFromSequence, filledSequence: order.filledSequence,
          filledAt: order.filledAt ? new Date(order.filledAt) : null,
          filledPrice: order.filledPrice, cancelReason: order.cancelReason,
        },
      });
    }
    if (fills.length) {
      await tx.paperFill.createMany({ data: fills.map((fill) => ({ ...fill, sessionId: session.id, timestamp: new Date(fill.timestamp) })) });
    }

    let activeTrade = fills.length ? await tx.paperTrade.findFirst({ where: { sessionId: session.id, status: "OPEN" } }) : null;
    for (const fill of fills) {
      const parent = orders.find((order) => order.id === fill.orderId);
      const risk = parent?.riskAmount != null && fill.quantity > 0
        ? parent.riskAmount * fill.openedQuantity / fill.quantity
        : parent?.stopLoss == null ? null : Math.abs(fill.price - parent.stopLoss) * fill.openedQuantity;
      if (fill.reason === "ENTRY") {
        activeTrade = await tx.paperTrade.create({ data: { sessionId: session.id, side: fill.netQuantityAfter > 0 ? "LONG" : "SHORT", openedSequence: fill.sequence, openedAt: new Date(fill.timestamp), fees: fill.fee, plannedRisk: risk } });
      } else if (fill.reason === "ADD" && activeTrade) {
        activeTrade = await tx.paperTrade.update({ where: { id: activeTrade.id }, data: { fees: { increment: fill.fee }, plannedRisk: risk == null ? undefined : { increment: risk } } });
      } else if (fill.reason === "REDUCE" && activeTrade) {
        activeTrade = await tx.paperTrade.update({ where: { id: activeTrade.id }, data: { grossPnl: { increment: fill.realizedPnl }, fees: { increment: fill.fee } } });
      } else if ((fill.reason === "CLOSE" || fill.reason === "STOP_LOSS" || fill.reason === "TAKE_PROFIT") && activeTrade) {
        await tx.paperTrade.update({ where: { id: activeTrade.id }, data: { status: "CLOSED", grossPnl: { increment: fill.realizedPnl }, fees: { increment: fill.fee }, closedSequence: fill.sequence, closedAt: new Date(fill.timestamp) } });
        activeTrade = null;
      } else if (fill.reason === "REVERSE") {
        const closingFee = fill.quantity ? fill.fee * fill.closedQuantity / fill.quantity : 0;
        if (activeTrade) await tx.paperTrade.update({ where: { id: activeTrade.id }, data: { status: "CLOSED", grossPnl: { increment: fill.realizedPnl }, fees: { increment: closingFee }, closedSequence: fill.sequence, closedAt: new Date(fill.timestamp) } });
        activeTrade = await tx.paperTrade.create({ data: { sessionId: session.id, side: fill.netQuantityAfter > 0 ? "LONG" : "SHORT", openedSequence: fill.sequence, openedAt: new Date(fill.timestamp), fees: fill.fee - closingFee, plannedRisk: risk } });
      }
    }
    // These sequence numbers are new and protected by the same progress/version transaction.
    // Keep every selected sample, but avoid hundreds of round trips for one displayed candle.
    for (let index = 0; index < equityPoints.length; index += 1000) {
      await tx.paperEquityPoint.createMany({
        data: equityPoints.slice(index, index + 1000).map((point) => ({
          ...point, sessionId: session.id, timestamp: new Date(point.timestamp),
        })),
      });
    }
    await tx.replayProgress.update({ where: { datasetId: id }, data: { currentSequence: targetSequence } });
    return { status: 200, error: null, currentSequence: targetSequence, paper: true, bars: dbBars, completedDisplayBucketStart, aggregatedBars, lastSourceBar, snapshot: await getPaperSessionSnapshot(id, tx) } as const;
  }, { timeout: 120_000 });

  if (outcome.error) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({
    currentSequence: outcome.currentSequence,
    advancedBars: parsed.data.displayIntervalSeconds === undefined ? outcome.bars.map(serializeSourceBar) : [],
    completedDisplayBucketStart: outcome.completedDisplayBucketStart,
    aggregatedBars: outcome.aggregatedBars,
    lastSourceBar: outcome.lastSourceBar,
    snapshot: outcome.paper ? outcome.snapshot : null,
  });
}
