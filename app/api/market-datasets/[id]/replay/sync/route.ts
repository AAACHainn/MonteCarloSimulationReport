import { withReplaySessionRoute } from '@/lib/replay-sessions/scope';
import { NextResponse } from "next/server";
import { replayDatabaseQueryCount } from "@/lib/db";
import { MAX_REPLAY_BULK_SOURCE_BARS, MAX_REPLAY_SYNC_SOURCE_BARS } from "@/lib/market-replay/types";
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
  const { batchMode, ...input } = parsed.data;
  const outcome = await syncReplayToTarget(id, {
    ...input,
    preserveSyncSamples: batchMode === "BULK",
    expectedPaperVersion: parsed.data.expectedPaperVersion ?? null,
  }, batchMode === "BULK" ? MAX_REPLAY_BULK_SOURCE_BARS : MAX_REPLAY_SYNC_SOURCE_BARS);
  const response = outcome.status !== 200
    ? NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status })
    : NextResponse.json(outcome.response);
  return attachReplayDiagnostics(response, {
    startedAt,
    queryStart,
    strategy: "idempotent-replay-sync",
    phases: outcome.phases,
  });
}

export const POST = withReplaySessionRoute(handlePOST, { write: true, annotation: false, diagnostics: true, receipt: true });
