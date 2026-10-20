import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aggregationStatus, cancelAggregation, queueAggregation } from "@/lib/market-replay/aggregation-jobs";
import { startAggregationWorker } from "@/lib/market-replay/aggregation-worker";
import { copy } from "@/lib/i18n";
import { SyncError } from "@/lib/market-sync/security";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!await prisma.marketDataset.findUnique({ where: { id } })) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  return NextResponse.json(await aggregationStatus(id), { headers: { "Cache-Control": "no-store" } });
}
const input = z.object({ action: z.enum(["rebuild", "resume", "cancel"]), jobId: z.string().optional() });
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.action === "resume" && !parsed.data.jobId)) return NextResponse.json({ error: copy.marketReplay.aggregation.unavailable }, { status: 400 });
  if (!await prisma.marketDataset.findUnique({ where: { id, status: "READY" } })) return NextResponse.json({ error: copy.marketReplay.datasetNotFound }, { status: 404 });
  try {
    if (parsed.data.action === "cancel") await cancelAggregation(id);
    else {
      const job = await queueAggregation(id, parsed.data.action === "resume" ? parsed.data.jobId : undefined);
      if (job.status === "QUEUED") {
        try { startAggregationWorker(job.id); }
        catch (error) {
          await prisma.marketAggregationJob.updateMany({ where: { id: job.id, status: "QUEUED" }, data: { status: "FAILED", activeDatasetId: null, error: copy.marketReplay.aggregation.failed } });
          throw error;
        }
      }
    }
    return NextResponse.json(await aggregationStatus(id), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : copy.marketReplay.aggregation.failed }, { status: error instanceof SyncError ? error.status : 409 });
  }
}
