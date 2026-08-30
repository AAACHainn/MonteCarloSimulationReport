import { NextResponse } from "next/server";
import { copy } from "@/lib/i18n";
import { processImportJob } from "@/lib/market-replay/import-jobs";

export const runtime = "nodejs";
export const maxDuration = 3_600;
type RouteContext = { params: Promise<{ jobId: string }> };
export async function POST(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  try {
    await processImportJob(jobId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : copy.marketReplay.importError }, { status: 400 });
  }
}
