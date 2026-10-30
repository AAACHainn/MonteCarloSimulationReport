import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const baseline = JSON.parse(readFileSync(resolve("tmp/replay-migration-baseline.json"), "utf8"));
const before = new DatabaseSync(baseline.backup, { readOnly: true });
const after = new DatabaseSync(resolve("prisma/dev.db"), { readOnly: true });
const referenceColumns = new Set(["id", "sessionId", "orderId", "entryFillId", "lotId", "A"]);
function logicalId(value) {
  if (typeof value !== "string" || !value.startsWith("projection::")) return value;
  const delimiter = value.indexOf("::", 12);
  return delimiter < 0 ? value : value.slice(delimiter + 2);
}
function digest(db, table, columns, primary, repairCursor) {
  const order = primary.map((name) => referenceColumns.has(name)
    ? `CASE WHEN substr("${name}",1,12)='projection::' THEN substr("${name}",14+instr(substr("${name}",13),'::')) ELSE "${name}" END`
    : `"${name}"`).join(",") || columns.map((name) => `"${name}"`).join(",");
  const hash = createHash("sha256");
  const statement = db.prepare(`SELECT ${columns.map((name) => `"${name}"`).join(",")} FROM "${table}" ORDER BY ${order} LIMIT 5000 OFFSET ?`);
  for (let offset = 0;; offset += 5000) {
    const rows = statement.all(offset);
    if (!rows.length) break;
    for (const row of rows) {
    for (const key of referenceColumns) if (key in row) row[key] = logicalId(row[key]);
    if (table === "ReplayProgress" && repairCursor) {
      const account = before.prepare('SELECT lastProcessedSequence FROM PaperTradingSession WHERE datasetId=?').get(row.datasetId);
      if (account) row.currentSequence = account.lastProcessedSequence;
    }
      hash.update(JSON.stringify(row) + "\n");
    }
  }
  return hash.digest("hex");
}
try {
  const checked = [];
  for (const [table, count] of Object.entries(baseline.counts)) {
    assert.equal(after.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n, count, `${table}: row count changed`);
    const info = before.prepare(`PRAGMA table_info("${table}")`).all();
    const columns = info.map((column) => column.name).filter((name) => table !== "ReplayProgress" || !["lastSyncRequestId", "lastSyncResponse"].includes(name));
    const primary = info.filter((column) => column.pk).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    assert.equal(digest(after, table, columns, primary, false), digest(before, table, columns, primary, true), `${table}: original facts changed`);
    checked.push({ table, count });
  }
  assert.deepEqual(after.prepare("PRAGMA foreign_key_check").all(), []);
  console.log(JSON.stringify({ preserved: checked, foreignKeys: "valid", backup: baseline.backup }, null, 2));
} finally { before.close(); after.close(); }
