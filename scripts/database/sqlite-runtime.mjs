import { existsSync } from "node:fs";
import { createDatabaseClient } from "../../lib/sqlite-client.mjs";
if (existsSync(".env")) process.loadEnvFile(".env");
const allowed = new Set(["--integrity"]);
for (const arg of process.argv.slice(2)) if (!allowed.has(arg)) throw new Error("Unknown runtime diagnostic argument");
const prisma = createDatabaseClient();
try {
  const runtime = {
    driver: process.env.SQLITE_DRIVER || "native",
    version: await prisma.$queryRawUnsafe("SELECT sqlite_version() AS version"),
    database: await prisma.$queryRawUnsafe("PRAGMA database_list"),
    journalMode: await prisma.$queryRawUnsafe("PRAGMA journal_mode"),
    synchronous: await prisma.$queryRawUnsafe("PRAGMA synchronous"),
    foreignKeys: await prisma.$queryRawUnsafe("PRAGMA foreign_keys"),
    ...(process.argv.includes("--integrity") ? { integrity: await prisma.$queryRawUnsafe("PRAGMA integrity_check"), foreignKeyCheck: await prisma.$queryRawUnsafe("PRAGMA foreign_key_check") } : {}),
  };
  console.log(JSON.stringify(runtime, (_key, value) => typeof value === "bigint" ? Number(value) : value, 2));
} finally { await prisma.$disconnect(); }
