import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { loadReplayScope, runWithReplayScope, replayErrorResponse, ReplaySessionError, assertReplayWritable, markReplayMutation } from "@/lib/replay-sessions/scope";
import { getPaperSessionSnapshot, serializePaperOrder } from "@/lib/paper-trading/serialize";
import { activateTrainingGate, cancelUncheckedEntries, parseTrainingGate } from "@/lib/paper-trading/training-gate";

type Context = { params: Promise<{ sessionId: string }> };
const schema = z.object({ expectedVersion: z.number().int().positive(), tradeCount: z.number().int().positive().max(2147483647),
  autoEnabled: z.boolean().optional(), lossThreshold: z.number().int().positive().max(2147483647).optional(), nextMode: z.enum(["CHECKLIST", "PLAN"]).optional() }).strict();
export async function GET(_request: Request, context: Context) {
  try {
    const scope = await loadReplayScope((await context.params).sessionId);
    if (scope.mode !== "TRAINING") throw new ReplaySessionError("MODE_NOT_ALLOWED", 403, copy.trainingGate.trainingOnly);
    return NextResponse.json({ gate: scope.trainingGate, version: scope.version });
  } catch (error) { return replayErrorResponse(error); }
}
async function write(request: Request, context: Context, start: boolean) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: copy.trainingGate.invalidCount }, { status: 400 });
    const scope = await loadReplayScope((await context.params).sessionId);
    if (scope.mode !== "TRAINING") throw new ReplaySessionError("MODE_NOT_ALLOWED", 403, copy.trainingGate.trainingOnly);
    if (request.headers.get("X-Replay-Projection") !== scope.projectionId || parsed.data.expectedVersion !== scope.version) {
      throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
    }
    return await runWithReplayScope(scope, async () => {
      const gate = await sqliteWriteTransaction(prisma, async (tx) => {
        await assertReplayWritable(tx);
        const owner = await tx.replaySession.findUniqueOrThrow({ where: { id: scope.id } });
        let gate = parseTrainingGate(owner.trainingGate);
        if (gate.active) throw new ReplaySessionError("GATE_ACTIVE", 409, copy.trainingGate.locked);
        const autoEnabled = parsed.data.autoEnabled ?? gate.autoEnabled;
        const lossThreshold = parsed.data.lossThreshold ?? gate.lossThreshold;
        if (gate.autoEnabled !== autoEnabled || gate.lossThreshold !== lossThreshold) gate.lossStreak = 0;
        gate.tradeCount = parsed.data.tradeCount;
        gate.autoEnabled = autoEnabled;
        gate.lossThreshold = lossThreshold;
        gate.nextMode = parsed.data.nextMode ?? gate.nextMode;
        if (start) {
          const progress = await tx.replayProgress.findUniqueOrThrow({ where: { replaySessionId: scope.id } });
          gate = activateTrainingGate(gate, "MANUAL", progress.currentSequence);
          const account = await tx.paperTradingSession.findUnique({ where: { projectionId: scope.projectionId } });
          if (account) {
            const records = await tx.paperOrder.findMany({ where: { sessionId: account.id, status: "PENDING" } });
            const orders = records.map(serializePaperOrder);
            gate.cancelledOrderCount = cancelUncheckedEntries(orders, account.netQuantity, undefined, gate.activeMode);
            for (let i = 0; i < orders.length; i++) {
              if (orders[i].status !== records[i].status || orders[i].reduceOnly !== records[i].reduceOnly) {
                await tx.paperOrder.update({ where: { id: records[i].id }, data: {
                  status: orders[i].status, reduceOnly: orders[i].reduceOnly, cancelReason: orders[i].cancelReason,
                } });
              }
            }
            await tx.paperTradingSession.update({ where: { id: account.id }, data: { version: { increment: 1 } } });
          }
        }
        await tx.replaySession.update({ where: { id: scope.id }, data: { trainingGate: JSON.stringify(gate) } });
        await markReplayMutation(tx);
        return gate;
      });
      return NextResponse.json({ gate, version: scope.version + 1, snapshot: await getPaperSessionSnapshot(scope.datasetId) });
    });
  } catch (error) { return replayErrorResponse(error); }
}
export const PUT = (request: Request, context: Context) => write(request, context, false);
export const POST = (request: Request, context: Context) => write(request, context, true);
