import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeMarketDataset } from "@/lib/market-replay/serialize";

export async function GET() {
  const datasets = await prisma.marketDataset.findMany({
    where: { status: "READY" },
    include: { progress: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(datasets.map(serializeMarketDataset));
}

export async function POST(request: Request) {
  void request;
  return NextResponse.json({ error: "请使用 /api/market-dataset-imports 流式导入行情。" }, { status: 410 });
}
