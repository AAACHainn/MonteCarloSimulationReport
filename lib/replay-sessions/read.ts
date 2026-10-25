import { prisma } from "@/lib/db";
import type { ReplaySessionSummary } from "./types";
import type { DisplaySession } from "@/lib/market-replay/types";

export async function listReplaySessions(datasetId: string, userId?: string | null): Promise<ReplaySessionSummary[]> {
  const sessions = await prisma.replaySession.findMany({
    where: { datasetId, ...(userId ? { userId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      user: { select: { id: true, nickname: true } },
      progress: true,
      propAccount: { include: { rounds: { select: { projection: { select: { _count: { select: { entries: true } } } } } } } },
      activeProjection: { select: { _count: { select: { entries: true } } } },
    },
  });
  return sessions.map((session) => ({
    id: session.id, datasetId, name: session.name,
    userId: session.userId, owner: session.user, ownershipSource: session.ownershipSource, growthEligible: session.growthEligible,
    mode: session.mode as ReplaySessionSummary["mode"], status: session.status as ReplaySessionSummary["status"],
    version: session.version, activeProjectionId: session.activeProjectionId!, pendingCorrectionId: session.pendingCorrectionId,
    legacy: session.legacy, riskPreferences: JSON.parse(session.riskPreferences),
    accountCategory: session.accountCategory,
    propAccount: session.propAccount ? { snapshot: JSON.parse(session.propAccount.snapshot), state: JSON.parse(session.propAccount.state), roundNumber: session.propAccount.roundNumber } : null,
    entryCount: session.propAccount ? session.propAccount.rounds.reduce((sum, round) => sum + round.projection._count.entries, 0) : session.activeProjection?._count.entries ?? 0,
    createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString(),
    progress: session.progress ? {
      startSequence: session.progress.startSequence, currentSequence: session.progress.currentSequence,
      generation: session.progress.generation, syncVersion: session.progress.syncVersion,
      playbackRate: session.progress.playbackRate, displayIntervalSeconds: session.progress.displayIntervalSeconds ?? 1,
      displaySession: session.progress.displaySession as DisplaySession, updatedAt: session.progress.updatedAt.toISOString(),
    } : null,
  }));
}
