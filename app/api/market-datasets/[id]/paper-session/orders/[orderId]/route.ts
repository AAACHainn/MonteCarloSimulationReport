import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
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
    const [order, progress] = await Promise.all([
      tx.paperOrder.findFirst({ where: { id: orderId, sessionId: session.id, status: "PENDING" } }),
      tx.replayProgress.findUnique({ where: { datasetId: id } }),
    ]);
    if (!order || !progress) return { status: 404, error: copy.paperTrading.orderNotFound };
    if (parsed.data.price !== undefined && order.type === "MARKET") return { status: 400, error: copy.paperTrading.orderUpdateRequired };
    if (order.isProtective && parsed.data.price !== undefined) {
      const currentBar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: id, sequence: progress.currentSequence } } });
      const isLong = session.netQuantity > 0;
      const valid = currentBar && (order.type === "STOP"
        ? isLong ? parsed.data.price < currentBar.close : parsed.data.price > currentBar.close
        : isLong ? parsed.data.price > currentBar.close : parsed.data.price < currentBar.close);
      if (!valid) return { status: 400, error: copy.paperTrading.invalidBracket };
    }
    await tx.paperOrder.update({
      where: { id: orderId },
      data: {
        quantity: order.isProtective ? undefined : parsed.data.quantity,
        price: parsed.data.price,
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
