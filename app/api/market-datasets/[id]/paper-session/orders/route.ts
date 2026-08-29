import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getPaperSessionSnapshot } from "@/lib/paper-trading/serialize";
import { paperOrderSchema } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

function validBracket(side: "BUY" | "SELL", reference: number, stopLoss?: number | null, takeProfit?: number | null) {
  if (side === "BUY") return (stopLoss == null || stopLoss < reference) && (takeProfit == null || takeProfit > reference);
  return (stopLoss == null || stopLoss > reference) && (takeProfit == null || takeProfit < reference);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = paperOrderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.paperTradingSession.findUnique({ where: { datasetId: id } });
    if (!session) return { status: 404, error: copy.paperTrading.sessionNotFound };
    if (session.version !== parsed.data.expectedVersion) return { status: 409, error: copy.paperTrading.conflict };
    const [progress, dataset] = await Promise.all([
      tx.replayProgress.findUnique({ where: { datasetId: id } }),
      tx.marketDataset.findUnique({ where: { id }, select: { barCount: true } }),
    ]);
    if (!progress || !dataset || progress.currentSequence < 0) return { status: 400, error: copy.paperTrading.noCurrentBar };
    if (progress.currentSequence >= dataset.barCount - 1) return { status: 400, error: copy.paperTrading.noNextBar };
    const currentBar = await tx.marketBar.findUnique({ where: { datasetId_sequence: { datasetId: id, sequence: progress.currentSequence } } });
    const reference = parsed.data.price ?? currentBar?.close;
    if (reference == null || !validBracket(parsed.data.side, reference, parsed.data.stopLoss, parsed.data.takeProfit)) {
      return { status: 400, error: copy.paperTrading.invalidBracket };
    }
    await tx.paperOrder.create({
      data: {
        sessionId: session.id,
        side: parsed.data.side,
        type: parsed.data.type,
        quantity: parsed.data.quantity,
        price: parsed.data.type === "MARKET" ? null : parsed.data.price,
        stopLoss: parsed.data.reduceOnly ? null : parsed.data.stopLoss,
        takeProfit: parsed.data.reduceOnly ? null : parsed.data.takeProfit,
        reduceOnly: parsed.data.reduceOnly,
        createdSequence: progress.currentSequence,
        activeFromSequence: progress.currentSequence + 1,
      },
    });
    await tx.paperTradingSession.update({ where: { id: session.id }, data: { version: { increment: 1 } } });
    return { status: 201, error: null };
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) }, { status: 201 });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { expectedVersion?: number; scope?: "ALL" | "BRACKET" };
  const session = await prisma.paperTradingSession.findUnique({ where: { datasetId: id } });
  if (!session) return NextResponse.json({ error: copy.paperTrading.sessionNotFound }, { status: 404 });
  if (session.version !== body.expectedVersion) return NextResponse.json({ error: copy.paperTrading.conflict }, { status: 409 });
  await prisma.$transaction([
    prisma.paperOrder.updateMany({
      where: { sessionId: session.id, status: "PENDING", ...(body.scope === "BRACKET" ? { isProtective: true } : { isProtective: false }) },
      data: { status: "CANCELLED", cancelReason: "USER_CANCELLED" },
    }),
    prisma.paperTradingSession.update({ where: { id: session.id }, data: { version: { increment: 1 } } }),
  ]);
  return NextResponse.json({ snapshot: await getPaperSessionSnapshot(id) });
}
