import { parseTrainingGate, type TrainingGateState } from "@/lib/paper-trading/training-gate";
import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { projectionRecordId } from "./identity";

export type ReplayScope = {
  id: string;
  datasetId: string;
  projectionId: string;
  mode: "TRAINING" | "LIVE_REPLAY";
  status: string;
  version: number;
  trainingGate?: TrainingGateState | null;
};

export class ReplaySessionError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

const storage = new AsyncLocalStorage<ReplayScope>();
export const getReplayScope = () => storage.getStore();
export const storageId = (id: string) => projectionRecordId(getReplayScope()?.projectionId, id);
export const runWithReplayScope = <T>(scope: ReplayScope, work: () => T): T => storage.run(scope, work);

// Null scope is reserved for legacy fixtures and internal compatibility readers.
// Every public trading route requires an explicit session before using these filters.
export function progressWhere(datasetId: string) {
  return { datasetId, replaySessionId: getReplayScope()?.id ?? null };
}
export function accountWhere(datasetId: string) {
  return { datasetId, projectionId: getReplayScope()?.projectionId ?? null };
}
export function entryProjectionWhere() {
  const scope = getReplayScope();
  return scope ? { projectionId: scope.projectionId } : {};
}
export function drawingScopeWhere() {
  return { replaySessionId: getReplayScope()?.id ?? null };
}
export function journalScopeWhere() {
  const scope = getReplayScope();
  return scope ? { replaySessionId: scope.id } : {};
}

export async function loadReplayScope(id: string, datasetId?: string): Promise<ReplayScope> {
  const session = await prisma.replaySession.findUnique({ where: { id } });
  if (!session || !session.activeProjectionId || (datasetId && session.datasetId !== datasetId)) {
    throw new ReplaySessionError("SESSION_NOT_FOUND", 404, copy.replaySessions.missing);
  }
  return {
    id: session.id, datasetId: session.datasetId, projectionId: session.activeProjectionId,
    mode: session.mode as ReplayScope["mode"], status: session.status, version: session.version,
    trainingGate: session.mode === "TRAINING" ? parseTrainingGate(session.trainingGate) : null,
  };
}

export async function assertReplayWritable(tx: Prisma.TransactionClient, checkHistory = true) {
  const scope = getReplayScope();
  if (!scope) return;
  const session = await tx.replaySession.findUnique({ where: { id: scope.id }, include: { activeProjection: { select: { historyVersion: true } }, dataset: { select: { historyVersion: true } } } });
  if (!session || session.activeProjectionId !== scope.projectionId || session.version !== scope.version) {
    throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
  }
  if (session.status !== "ACTIVE") throw new ReplaySessionError("SESSION_ARCHIVED", 409, copy.replaySessions.readOnly);
  if (session.pendingCorrectionId) throw new ReplaySessionError("CORRECTION_PENDING", 409, copy.replaySessions.busy);
  if (checkHistory && session.activeProjection?.historyVersion !== session.dataset.historyVersion) throw new ReplaySessionError("HISTORY_CHANGED", 409, copy.marketSync.historyChanged);
}

/** Archived charts remain editable annotations; trading writes keep their existing guard. */
export async function assertReplayDrawingWritable(tx: Prisma.TransactionClient) {
  const scope = getReplayScope();
  if (!scope) return;
  if (scope.status !== "ARCHIVED") return assertReplayWritable(tx);
  const session = await tx.replaySession.findUnique({ where: { id: scope.id } });
  if (!session || session.status !== "ARCHIVED" || session.activeProjectionId !== scope.projectionId || session.version !== scope.version) {
    throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
  }
  if (session.pendingCorrectionId) throw new ReplaySessionError("CORRECTION_PENDING", 409, copy.replaySessions.busy);
}

export async function markReplayMutation(tx: Prisma.TransactionClient, currentSequence?: number) {
  const scope = getReplayScope();
  if (!scope) return;
  await tx.replaySession.update({ where: { id: scope.id }, data: { version: { increment: 1 } } });
  if (currentSequence !== undefined) await tx.replayProjection.update({
    where: { id: scope.projectionId }, data: { currentSequence },
  });
}

export function replayErrorResponse(error: unknown) {
  if (error instanceof ReplaySessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error("Replay session request failed.", error);
  return NextResponse.json({ error: copy.replaySessions.requestFailed }, { status: 500 });
}

export function withReplaySessionRoute<P extends { id: string }>(
  handler: (request: Request, context: { params: Promise<P> }) => Promise<Response>,
  options: { write?: boolean; annotation?: boolean; allowHistoryChange?: boolean; drawing?: boolean } = {},
) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      const { id: datasetId } = await context.params;
      const url = new URL(request.url);
      const sessionId = url.searchParams.get("replaySessionId");
      const inherited = getReplayScope();
      if (!sessionId && !inherited) throw new ReplaySessionError("SESSION_REQUIRED", 409, copy.replaySessions.required);
      const scope = inherited ?? await loadReplayScope(sessionId!, datasetId);
      if (scope.datasetId !== datasetId || (sessionId && scope.id !== sessionId)) {
        throw new ReplaySessionError("SESSION_NOT_FOUND", 404, copy.replaySessions.missing);
      }
      return await runWithReplayScope(scope, async () => {
        if (options.write && !options.annotation) {
          if (request.headers.get("X-Replay-Projection") !== scope.projectionId) {
            throw new ReplaySessionError("SESSION_CONFLICT", 409, copy.replaySessions.conflict);
          }
          if (options.drawing) await assertReplayDrawingWritable(prisma);
          else await assertReplayWritable(prisma, !options.allowHistoryChange);
        }
        return handler(request, context);
      });
    } catch (error) { return replayErrorResponse(error); }
  };
}
