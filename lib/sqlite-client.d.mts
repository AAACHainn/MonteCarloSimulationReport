import type { Prisma, PrismaClient } from "@prisma/client";
export const SQLITE_DRIVER_VERSION: "3.51.3";
export type SqliteConnectionInfo = {
  driver: "better-sqlite3";
  sqliteVersion: string;
  journalMode: string;
  synchronous: number;
  foreignKeys: boolean;
  databasePath: string;
};
export type DatabaseClientSettings = {
  env?: Record<string, string | undefined>;
  projectRoot?: string;
  allowCreate?: boolean;
  onConnected?: (info: SqliteConnectionInfo) => void;
};
export function resolveSqlitePath(url: string, projectRoot?: string): string;
export function createDatabaseClient(options?: Prisma.PrismaClientOptions, settings?: DatabaseClientSettings): PrismaClient;
