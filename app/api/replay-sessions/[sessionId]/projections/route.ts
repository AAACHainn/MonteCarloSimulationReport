import { NextResponse } from "next/server";
import { loadReplayScope, replayErrorResponse } from "@/lib/replay-sessions/scope";
import { listReplayProjections } from "@/lib/replay-sessions/read";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const scope = await loadReplayScope((await context.params).sessionId);
    return NextResponse.json({ projections: await listReplayProjections(scope.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return replayErrorResponse(error); }
}
