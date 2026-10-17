import { withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { NextResponse } from "next/server";
import { replayDatabaseQueryCount } from "@/lib/db";
import { syncReplayToTarget } from "@/lib/market-replay/replay-sync";
import { replayServerSyncSchema } from "@/lib/validations";
import { attachReplayDiagnostics } from "@/lib/market-replay/server-diagnostics";

type RouteContext = { params: Promise<{ id: string }> };

async function handlePOST(request: Request, context: RouteContext) {
  const startedAt = performance.now();
  const queryStart = replayDatabaseQueryCount();
  const { id } = await context.params;
  const parsed = replayServerSyncSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const outcome = await syncReplayToTarget(id, {
    ...parsed.data,
    expectedPaperVersion: parsed.data.expectedPaperVersion ?? null,
  });
  const response = outcome.status !== 200
    ? NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status })
    : NextResponse.json(outcome.response);
  return attachReplayDiagnostics(response, {
    startedAt,
    queryStart,
    strategy: "idempotent-replay-sync",
  });
}

export const POST = withReplaySessionRoute(handlePOST, { write: true, annotation: false });
