import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { calculateRiskSizing, isValidBracket } from "@/lib/paper-trading/risk-sizing";
import { isPriceOnTick } from "@/lib/market-replay/price-ticks";
import { paperOrderUpdateSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string; orderId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id, orderId } = await context.params;
  const parsed = paperOrderUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.paperTradingSession.findUnique({ where: { datasetId: id } });
    if (!session) return { status: 404, error: copy.paperTrading.sessionNotFound };
    if (session.version !== parsed.data.expectedVersion) return { status: 409, error: copy.paperTrading.conflict };
    const [order, progress, dataset] = await Promise.all([
      tx.paperOrder.findFirst({ where: { id: orderId, sessionId: session.id, status: "PENDING" } }),
      tx.replayProgress.findUnique({ where: { datasetId: id } }),
      tx.marketDataset.findUnique({ where: { id }, select: { priceTickSize: true } }),
    ]);
    if (!order || !progress || !dataset) return { status: 404, error: copy.paperTrading.orderNotFound };
    if (parsed.data.price !== undefined && order.type === "MARKET") return { status: 400, error: copy.paperTrading.orderUpdateRequired };
    const prices = [parsed.data.price, parsed.data.stopLoss, parsed.data.takeProfit].filter((value): value is number => value !== null && value !== undefined);
    if (prices.some((price) => !isPriceOnTick(price, dataset.priceTickSize))) {
      return { status: 400, error: copy.paperTrading.priceNotOnTick };
    }
    const currentBar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: id, sequence: progress.currentSequence } } });
    if (!currentBar) return { status: 400, error: copy.paperTrading.noCurrentBar };
    if (order.isProtective) {
      if (parsed.data.stopLoss !== undefined || parsed.data.takeProfit !== undefined
          || parsed.data.riskAmount !== undefined || parsed.data.quantity !== undefined
          || parsed.data.price === undefined) {
        return { status: 400, error: copy.paperTrading.orderUpdateRequired };
      }
      const isLong = session.netQuantity > 0;
      const valid = order.type === "STOP"
        ? isLong ? parsed.data.price < currentBar.close : parsed.data.price > currentBar.close
        : isLong ? parsed.data.price > currentBar.close : parsed.data.price < currentBar.close;
      if (!valid) return { status: 400, error: copy.paperTrading.invalidBracket };
    }
    const nextPrice = parsed.data.price ?? order.price;
    const reference = nextPrice ?? currentBar.close;
    const nextStopLoss = parsed.data.stopLoss !== undefined ? parsed.data.stopLoss : order.stopLoss;
    const nextTakeProfit = parsed.data.takeProfit !== undefined ? parsed.data.takeProfit : order.takeProfit;
    const nextRiskAmount = parsed.data.riskAmount !== undefined ? parsed.data.riskAmount : order.riskAmount;
    let nextQuantity = parsed.data.quantity ?? order.quantity;
    if (!order.isProtective) {
      if (!isValidBracket(order.side as "BUY" | "SELL", reference, nextStopLoss, nextTakeProfit)) {
        return { status: 400, error: copy.paperTrading.invalidBracket };
      }
      if (nextRiskAmount != null) {
        if (order.type === "MARKET" || nextStopLoss == null) {
          return { status: 400, error: copy.paperTrading.invalidBracket };
        }
        const sizing = calculateRiskSizing({
          side: order.side as "BUY" | "SELL",
          type: order.type as "LIMIT" | "STOP",
          entryPrice: reference,
          stopLoss: nextStopLoss,
          takeProfit: nextTakeProfit,
          riskAmount: nextRiskAmount,
          commissionBps: session.commissionBps,
          slippageBps: session.slippageBps,
        });
        if (!sizing.ok) return { status: 400, error: copy.paperTrading.invalidBracket };
        nextQuantity = sizing.value.quantity;
      }
    }
    await tx.paperOrder.update({
      where: { id: orderId },
      data: {
        quantity: order.isProtective ? undefined : nextQuantity,
        price: parsed.data.price,
        stopLoss: order.isProtective ? undefined : parsed.data.stopLoss,
        takeProfit: order.isProtective ? undefined : parsed.data.takeProfit,
        riskAmount: order.isProtective ? undefined : parsed.data.riskAmount,
        activeFromSequence: progress.currentSequence + 1,
      },
    });
    await tx.paperTradingSession.update({ where: { id: session.id }, data: { version: { increment: 1 } } });
    return { status: 200, error: null };
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id, orderId } = await context.params;
  const body = z.object({ expectedVersion: z.number().int().positive() }).safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: copy.paperTrading.conflict }, { status: 400 });
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.paperTradingSession.findUnique({ where: { datasetId: id } });
    if (!session) return { status: 404, error: copy.paperTrading.sessionNotFound };
    if (session.version !== body.data.expectedVersion) return { status: 409, error: copy.paperTrading.conflict };
    const updated = await tx.paperOrder.updateMany({
      where: { id: orderId, sessionId: session.id, status: "PENDING" },
      data: { status: "CANCELLED", cancelReason: "USER_CANCELLED" },
    });
    if (!updated.count) return { status: 404, error: copy.paperTrading.orderNotFound };
    await tx.paperTradingSession.update({ where: { id: session.id }, data: { version: { increment: 1 } } });
    return { status: 200, error: null };
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) });
}
