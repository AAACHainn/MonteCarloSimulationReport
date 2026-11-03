import { prisma } from "@/lib/db";
import { buildUserPropStatistics } from "./user-statistics";

export async function readUserPropStatistics(userId: string) {
  const [user, rounds, entries, passes] = await prisma.$transaction([
    prisma.userProfile.findUnique({ where: { id: userId }, select: { nickname: true } }),
    prisma.propPracticeRound.findMany({
      where: { account: { replaySession: { userId, mode: "TRAINING" } } },
      select: {
        replaySessionId: true, number: true, createdAt: true, endedAt: true, state: true,
        account: { select: { replaySession: { select: { name: true, status: true } } } },
      },
    }),
    prisma.userWalletEntry.findMany({
      where: { userId, type: { in: ["PURCHASE", "ACTIVATION", "PAYOUT"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { sessionId: true, roundNumber: true, sessionName: true, type: true, amountMinor: true, createdAt: true },
    }),
    prisma.userGrowthFact.findMany({
      where: { userId, type: "EVALUATION" },
      select: { sessionId: true, roundNumber: true, sourceSummary: true },
    }),
  ]);
  return user && { nickname: user.nickname, ...buildUserPropStatistics(rounds, entries, passes) };
}
