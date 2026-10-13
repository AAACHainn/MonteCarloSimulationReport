import { NextResponse } from "next/server";
import { correctionSchema, createCorrection } from "@/lib/replay-sessions/corrections";
import { replayErrorResponse } from "@/lib/replay-sessions/scope";
import { startReplayCorrectionWorker } from "@/lib/replay-sessions/worker";
import { copy } from "@/lib/i18n";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const parsed = correctionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: copy.replaySessions.correctionInvalid }, { status: 400 });
    const job = await createCorrection((await context.params).sessionId, parsed.data);
    if (job.status === "QUEUED" && !job.workerPid) await startReplayCorrectionWorker(job.id);
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (error) { return replayErrorResponse(error); }
}
