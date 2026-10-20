import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { datasetSourceInterval } from "@/lib/market-replay/dataset";
import { resolveDisplaySession } from "@/lib/market-replay/chart-sessions";
import { isValidDisplayInterval } from "@/lib/market-replay/types";
import { AggregationNotReadyError } from "@/lib/market-replay/aggregation-storage";
import { readCompleteWindow, readExportWindow, WindowVersionChangedError } from "@/lib/market-replay/export-window";
import { WindowReadBudgetError, WindowSourceBudgetError } from "@/lib/market-replay/aggregation-reader";

const query = z.object({
  anchorSequence: z.coerce.number().int().min(0), endSequence: z.coerce.number().int().min(0),
  dataVersion: z.coerce.number().int().min(1), displayIntervalSeconds: z.coerce.number().int().min(1).max(86400),
  displaySession: z.enum(["ETH", "RTH"]), direction: z.enum(["forward", "backward"]).default("forward"),
  count: z.coerce.number().int().min(1).max(200).default(200), warmupCount: z.coerce.number().int().min(0).max(1000).default(0),
}).refine((q) => q.anchorSequence <= q.endSequence);
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: copy.paperTrading.pdf.invalidWindow }, { status: 400 });
  const dataset = await prisma.marketDataset.findUnique({ where: { id } });
  if (!dataset || dataset.status !== "READY") return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  const q = parsed.data;
  if (dataset.dataVersion !== q.dataVersion || q.endSequence >= dataset.barCount)
    return NextResponse.json({ error: copy.paperTrading.pdf.versionConflict }, { status: 409 });
  const sourceSeconds = datasetSourceInterval(dataset);
  const session = resolveDisplaySession(dataset, q.displaySession);
  if (!sourceSeconds || !session || !isValidDisplayInterval(sourceSeconds, q.displayIntervalSeconds))
    return NextResponse.json({ error: copy.marketReplay.invalidDisplayInterval }, { status: 400 });
  let window;
  try { window = await (q.warmupCount ? readCompleteWindow : readExportWindow)({ dataset, datasetId: id, ...q, sourceSeconds, displaySeconds: q.displayIntervalSeconds, session }); }
  catch (error) {
    if (error instanceof AggregationNotReadyError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof WindowVersionChangedError) return NextResponse.json({ error: copy.paperTrading.pdf.versionConflict, code: "WINDOW_VERSION_CHANGED" }, { status: 409 });
    if (error instanceof WindowReadBudgetError || error instanceof WindowSourceBudgetError)
      return NextResponse.json({ error: copy.marketReplay.windowBudget, code: "WINDOW_BUDGET" }, { status: 422 });
    throw error;
  }
  const current = await prisma.marketDataset.findUnique({ where: { id }, select: { dataVersion: true } });
  if (!current) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  if (current.dataVersion !== q.dataVersion) return NextResponse.json({ error: copy.paperTrading.pdf.versionConflict }, { status: 409 });
  return NextResponse.json(window, { headers: { "Cache-Control": "no-store" } });
}
