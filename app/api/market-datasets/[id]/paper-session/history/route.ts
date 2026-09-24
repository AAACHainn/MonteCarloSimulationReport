import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { serializePaperFill, serializePaperOrder, serializePaperTrade } from "@/lib/paper-trading/serialize";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const session = await prisma.paperTradingSession.findUnique({ where: { datasetId: id } });
  if (!session) return NextResponse.json({ error: copy.paperTrading.sessionNotFound }, { status: 404 });
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "fills";
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") ?? 50)));
  const cursor = url.searchParams.get("cursor");
  if (type === "orders") {
    const orders = await prisma.paperOrder.findMany({ where: { sessionId: session.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const nextCursor = orders.length > take ? orders[take - 1]?.id ?? null : null;
    return NextResponse.json({ items: orders.slice(0, take).map(serializePaperOrder), nextCursor });
  }
  if (type === "trades") {
    const trades = await prisma.paperTrade.findMany({ where: { sessionId: session.id }, orderBy: [{ openedSequence: "desc" }, { id: "desc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const nextCursor = trades.length > take ? trades[take - 1]?.id ?? null : null;
    return NextResponse.json({ items: trades.slice(0, take).map(serializePaperTrade), nextCursor });
  }
  if (type === "equity") {
    const closedTrades = await prisma.paperTrade.findMany({
      where: { sessionId: session.id, status: "CLOSED" },
      orderBy: [{ closedSequence: "asc" }, { closedAt: "asc" }, { id: "asc" }],
      select: { grossPnl: true, fees: true },
    });
    if (!closedTrades.length) return NextResponse.json({ items: [] });
    let equity = session.initialCapital;
    const points = [
      { tradeNumber: 0, equity },
      ...closedTrades.map((trade, index) => {
        equity += trade.grossPnl - trade.fees;
        return { tradeNumber: index + 1, equity };
      }),
    ];
    const stride = Math.max(1, Math.ceil(points.length / 2_000));
    return NextResponse.json({
      items: points.filter((_point, index) => index % stride === 0 || index === points.length - 1),
    });
  }
  const fills = await prisma.paperFill.findMany({ where: { sessionId: session.id }, orderBy: [{ sequence: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  const nextCursor = fills.length > take ? fills[take - 1]?.id ?? null : null;
  return NextResponse.json({ items: fills.slice(0, take).map(serializePaperFill), nextCursor });
}
