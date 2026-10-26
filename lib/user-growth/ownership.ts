import type { Prisma } from "@prisma/client";
import { ReplaySessionError } from "@/lib/replay-sessions/scope";
import { copy } from "@/lib/i18n";

export type SessionOwnershipData = { userId: string | null; growthEligible: boolean };
export function newSessionOwnership(userId: string | null | undefined, mode: string): SessionOwnershipData {
  return { userId: userId ?? null, growthEligible: !!userId && mode === "TRAINING" };
}
export function inheritSessionOwnership(source: SessionOwnershipData, mode: string): SessionOwnershipData {
  return { userId: source.userId, growthEligible: source.growthEligible && mode === "TRAINING" };
}
export async function assertUserExists(tx: Prisma.TransactionClient, userId?: string | null) {
  if (userId && !await tx.userProfile.findUnique({ where: { id: userId }, select: { id: true } })) {
    throw new ReplaySessionError("USER_NOT_FOUND", 404, copy.userGrowth.userMissing);
  }
}
