import { NextResponse } from "next/server";
import { cancelCorrection, commitCorrection } from "@/lib/replay-sessions/corrections";
import { replayErrorResponse } from "@/lib/replay-sessions/scope";

export async function POST(_request: Request, context: { params: Promise<{ sessionId: string; jobId: string; action: string }> }) {
  try {
    const { sessionId, jobId, action } = await context.params;
    if (action === "commit") return NextResponse.json(await commitCorrection(sessionId, jobId));
    if (action === "cancel") { await cancelCorrection(sessionId, jobId); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  } catch (error) { return replayErrorResponse(error); }
}
