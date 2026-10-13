import { NextResponse } from "next/server";
import { readCorrection } from "@/lib/replay-sessions/corrections";
import { replayErrorResponse } from "@/lib/replay-sessions/scope";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string; jobId: string }> }) {
  try {
    const { sessionId, jobId } = await context.params;
    return NextResponse.json({ job: await readCorrection(sessionId, jobId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return replayErrorResponse(error); }
}
