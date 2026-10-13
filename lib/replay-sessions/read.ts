import { prisma } from "@/lib/db";
import type { ReplaySessionSummary } from "./types";
import type { DisplaySession } from "@/lib/market-replay/types";

export async function listReplaySessions(datasetId: string): Promise<ReplaySessionSummary[]> {
  const sessions = await prisma.replaySession.findMany({
    where: { datasetId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      progress: true,
      activeProjection: { select: { _count: { select: { entries: true } } } },
    },
  });
  return sessions.map((session) => ({
    id: session.id, datasetId, name: session.name,
    mode: session.mode as ReplaySessionSummary["mode"], status: session.status as ReplaySessionSummary["status"],
    version: session.version, activeProjectionId: session.activeProjectionId!, pendingCorrectionId: session.pendingCorrectionId,
    legacy: session.legacy, riskPreferences: JSON.parse(session.riskPreferences),
    entryCount: session.activeProjection?._count.entries ?? 0,
    createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString(),
    progress: session.progress ? {
      startSequence: session.progress.startSequence, currentSequence: session.progress.currentSequence,
      generation: session.progress.generation, syncVersion: session.progress.syncVersion,
      playbackRate: session.progress.playbackRate, displayIntervalSeconds: session.progress.displayIntervalSeconds ?? 1,
      displaySession: session.progress.displaySession as DisplaySession, updatedAt: session.progress.updatedAt.toISOString(),
    } : null,
  }));
}

export async function listReplayProjections(replaySessionId: string) {
  const projections = await prisma.replayProjection.findMany({ where: { replaySessionId, status: { in: ["CURRENT", "HISTORICAL"] } },
    orderBy: [{ generation: "desc" }, { createdAt: "desc" }], include: { _count: { select: { entries: true } } } });
  return projections.map((projection) => ({ id: projection.id, generation: projection.generation, status: projection.status,
    currentSequence: projection.currentSequence, entryCount: projection._count.entries, createdAt: projection.createdAt.toISOString() }));
}
export async function replaySessionView(session: ReplaySessionSummary, projectionId: string) {
  const projection = await prisma.replayProjection.findFirst({ where: { id: projectionId, replaySessionId: session.id, status: { in: ["CURRENT", "HISTORICAL"] } }, include: { _count: { select: { entries: true } } } });
  if (!projection) return null;
  return { ...session, activeProjectionId: projection.id, status: "ARCHIVED" as const, entryCount: projection._count.entries,
    progress: session.progress ? { ...session.progress, currentSequence: projection.currentSequence, generation: projection.generation } : null };
}
