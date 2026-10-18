import type { PrismaClient } from "@prisma/client";
import { createDatabaseClient } from "./sqlite-client.mjs";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  replayQueryCount?: number;
  replayQueryListenerAttached?: boolean;
};
const queryMetricsEnabled = process.env.REPLAY_QUERY_METRICS === "1";

export const prisma =
  globalForPrisma.prisma ??
  createDatabaseClient({
    log: [
      ...(process.env.NODE_ENV === "development" ? ["error", "warn"] as const : ["error"] as const),
      ...(queryMetricsEnabled ? [{ emit: "event" as const, level: "query" as const }] : []),
    ],
  }, {
    onConnected: ({ sqliteVersion, journalMode, synchronous }) => {
      console.info(JSON.stringify({ event: "sqlite-runtime", sqliteVersion, journalMode, synchronous }));
    },
  });

if (queryMetricsEnabled && !globalForPrisma.replayQueryListenerAttached) {
  (prisma as unknown as { $on(event: "query", callback: () => void): void }).$on("query", () => {
    globalForPrisma.replayQueryCount = (globalForPrisma.replayQueryCount ?? 0) + 1;
  });
  globalForPrisma.replayQueryListenerAttached = true;
}

export function replayDatabaseQueryCount() {
  return queryMetricsEnabled ? globalForPrisma.replayQueryCount ?? 0 : null;
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
