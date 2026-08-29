import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { advancePaperTrading } from "@/lib/paper-trading/engine";
import { getPaperSessionSnapshot, serializePaperOrder, serializePaperSession } from "@/lib/paper-trading/serialize";
import { paperAdvanceSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = paperAdvanceSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const outcome = await prisma.$transaction(async (tx) => {
    const [dataset, progress, session] = await Promise.all([
      tx.marketDataset.findUnique({ where: { id }, select: { barCount: true } }),
      tx.replayProgress.findUnique({ where: { datasetId: id } }),
      tx.paperTradingSession.findUnique({ where: { datasetId: id } }),
    ]);
    if (!dataset || !progress) return { status: 404, error: copy.marketReplay.datasetNotFound } as const;
    if (progress.currentSequence !== parsed.data.expectedCurrentSequence) return { status: 409, error: copy.paperTrading.conflict } as const;
    if (progress.currentSequence >= dataset.barCount - 1) return { status: 400, error: copy.paperTrading.noNextBar } as const;
    const nextSequence = progress.currentSequence + 1;
    const bar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: id, sequence: nextSequence } } });
    if (!bar) return { status: 404, error: copy.marketReplay.loadError } as const;

    if (!session) {
      await tx.replayProgress.update({ where: { datasetId: id }, data: { currentSequence: nextSequence } });
      return { status: 200, error: null, currentSequence: nextSequence, paper: false } as const;
    }
    if (session.version !== parsed.data.expectedVersion || session.lastProcessedSequence !== progress.currentSequence) {
      return { status: 409, error: copy.paperTrading.conflict } as const;
    }
    const dbOrders = await tx.paperOrder.findMany({ where: { sessionId: session.id, status: "PENDING" } });
    const result = advancePaperTrading({
      state: serializePaperSession(session),
      orders: dbOrders.map(serializePaperOrder),
      bar: { ...bar, timestamp: bar.timestamp.toISOString() },
      makeId: randomUUID,
    });

    await tx.paperTradingSession.update({
      where: { id: session.id },
      data: {
        lastProcessedSequence: result.state.lastProcessedSequence,
        netQuantity: result.state.netQuantity,
        averageEntryPrice: result.state.averageEntryPrice,
        realizedPnl: result.state.realizedPnl,
        totalFees: result.state.totalFees,
        totalSlippage: result.state.totalSlippage,
        peakEquity: result.state.peakEquity,
        maxDrawdown: result.state.maxDrawdown,
        version: result.state.version,
      },
    });
    for (const order of result.orders) {
      await tx.paperOrder.upsert({
        where: { id: order.id },
        create: {
          id: order.id, sessionId: session.id, side: order.side, type: order.type, status: order.status,
          quantity: order.quantity, price: order.price, stopLoss: order.stopLoss, takeProfit: order.takeProfit,
          reduceOnly: order.reduceOnly, isProtective: order.isProtective, ocoGroupId: order.ocoGroupId,
          createdSequence: order.createdSequence, activeFromSequence: order.activeFromSequence,
          filledSequence: order.filledSequence, filledAt: order.filledAt ? new Date(order.filledAt) : null,
          filledPrice: order.filledPrice, cancelReason: order.cancelReason,
        },
        update: {
          status: order.status, quantity: order.quantity, price: order.price,
          activeFromSequence: order.activeFromSequence, filledSequence: order.filledSequence,
          filledAt: order.filledAt ? new Date(order.filledAt) : null,
          filledPrice: order.filledPrice, cancelReason: order.cancelReason,
        },
      });
    }
    if (result.fills.length) {
      await tx.paperFill.createMany({ data: result.fills.map((fill) => ({
        ...fill, sessionId: session.id, timestamp: new Date(fill.timestamp),
      })) });
    }

    let activeTrade = await tx.paperTrade.findFirst({ where: { sessionId: session.id, status: "OPEN" } });
    for (const fill of result.fills) {
      const parent = result.orders.find((order) => order.id === fill.orderId);
      const risk = parent?.stopLoss == null ? null : Math.abs(fill.price - parent.stopLoss) * fill.openedQuantity;
      if (fill.reason === "ENTRY") {
        activeTrade = await tx.paperTrade.create({
          data: { sessionId: session.id, side: fill.netQuantityAfter > 0 ? "LONG" : "SHORT", openedSequence: fill.sequence, openedAt: new Date(fill.timestamp), fees: fill.fee, plannedRisk: risk },
        });
      } else if (fill.reason === "ADD" && activeTrade) {
        activeTrade = await tx.paperTrade.update({ where: { id: activeTrade.id }, data: { fees: { increment: fill.fee }, plannedRisk: risk == null ? undefined : { increment: risk } } });
      } else if (fill.reason === "REDUCE" && activeTrade) {
        activeTrade = await tx.paperTrade.update({ where: { id: activeTrade.id }, data: { grossPnl: { increment: fill.realizedPnl }, fees: { increment: fill.fee } } });
      } else if ((fill.reason === "CLOSE" || fill.reason === "STOP_LOSS" || fill.reason === "TAKE_PROFIT") && activeTrade) {
        await tx.paperTrade.update({
          where: { id: activeTrade.id },
          data: { status: "CLOSED", grossPnl: { increment: fill.realizedPnl }, fees: { increment: fill.fee }, closedSequence: fill.sequence, closedAt: new Date(fill.timestamp) },
        });
        activeTrade = null;
      } else if (fill.reason === "REVERSE") {
        const closingFee = fill.quantity ? fill.fee * fill.closedQuantity / fill.quantity : 0;
        if (activeTrade) {
          await tx.paperTrade.update({
            where: { id: activeTrade.id },
            data: { status: "CLOSED", grossPnl: { increment: fill.realizedPnl }, fees: { increment: closingFee }, closedSequence: fill.sequence, closedAt: new Date(fill.timestamp) },
          });
        }
        activeTrade = await tx.paperTrade.create({
          data: {
            sessionId: session.id, side: fill.netQuantityAfter > 0 ? "LONG" : "SHORT",
            openedSequence: fill.sequence, openedAt: new Date(fill.timestamp),
            fees: fill.fee - closingFee, plannedRisk: risk,
          },
        });
      }
    }
    await tx.paperEquityPoint.upsert({
      where: { sessionId_sequence: { sessionId: session.id, sequence: nextSequence } },
      create: { ...result.equityPoint, sessionId: session.id, timestamp: new Date(result.equityPoint.timestamp) },
      update: { balance: result.equityPoint.balance, equity: result.equityPoint.equity, drawdown: result.equityPoint.drawdown },
    });
    await tx.replayProgress.update({ where: { datasetId: id }, data: { currentSequence: nextSequence } });
    return { status: 200, error: null, currentSequence: nextSequence, paper: true } as const;
  });

  if (outcome.error) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({
    currentSequence: outcome.currentSequence,
    snapshot: outcome.paper ? await getPaperSessionSnapshot(id) : null,
  });
}
