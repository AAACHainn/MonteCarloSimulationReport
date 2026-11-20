import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { resolveSqlitePath } from "../../lib/sqlite-client.mjs";
import { applyBaselineMigrations } from "./sqlite-upgrade-plan.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const db = new Database(resolveSqlitePath(process.env.DATABASE_URL, root), { fileMustExist: true });
try {
  db.pragma("synchronous=FULL");
  applyBaselineMigrations(db, root);
} finally { db.close(); }
