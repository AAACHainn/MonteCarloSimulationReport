import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getScreenshotMimeType, readScreenshot } from "@/lib/trade-journal/storage";

type RouteContext = { params: Promise<{ id: string; tradeId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id, tradeId } = await context.params;
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, dataset: { tradeJournal: { id } } },
    select: { screenshotPath: true },
  });
  if (!trade?.screenshotPath) {
    return NextResponse.json({ error: "未找到交易截图。" }, { status: 404 });
  }

  try {
    const buffer = await readScreenshot(trade.screenshotPath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": getScreenshotMimeType(trade.screenshotPath),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "未找到交易截图。" }, { status: 404 });
  }
}
