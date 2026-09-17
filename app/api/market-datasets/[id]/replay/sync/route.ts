import { NextResponse } from "next/server";
import { replayDatabaseQueryCount } from "@/lib/db";
import { persistClientReplayBatch } from "@/lib/market-replay/replay-sync";
import { replaySyncSchema } from "@/lib/validations";
import { attachReplayDiagnostics } from "@/lib/market-replay/server-diagnostics";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const startedAt = performance.now();
  const queryStart = replayDatabaseQueryCount();
  const { id } = await context.params;
  const parsed = replaySyncSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const outcome = await persistClientReplayBatch(id, {
    ...parsed.data,
    expectedPaperVersion: parsed.data.expectedPaperVersion ?? null,
  });
  const response = outcome.status !== 200
    ? NextResponse.json({ error: outcome.error }, { status: outcome.status })
    : NextResponse.json(outcome.response);
  return attachReplayDiagnostics(response, {
    startedAt,
    queryStart,
    strategy: "idempotent-replay-sync",
  });
}
