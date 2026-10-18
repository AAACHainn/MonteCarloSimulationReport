import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, copyFileSync, writeFileSync, openSync, closeSync, constants } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PrismaClient, Prisma } = require("@prisma/client");
const { reportDirectory, validationClientClass } = require("./client.cjs");
if (process.argv.length !== 4 || process.argv[2] !== "--source") throw new Error("Usage: check-copy.mjs --source <existing SQLite file>");
if (process.env.SQLITE_WAL_VALIDATION_MODE) throw new Error("Run the copy check outside the validation preload environment");
const source = resolve(process.argv[3]);
const directory = join(reportDirectory, "copy-" + randomUUID());
mkdirSync(directory, { recursive: true });
const pristine = join(directory, "pristine.db");
const working = join(directory, "working.db");
// The source is opened read-only. SQLite's online backup API produces a consistent snapshot.
const original = new DatabaseSync(source, { readOnly: true });
try {
  const marker = openSync(pristine, "wx"); closeSync(marker);
  console.log("Creating a read-only source backup in", directory);
  await backup(original, pristine);
} finally { original.close(); }
copyFileSync(pristine, working, constants.COPYFILE_EXCL);
const serialize = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
async function fingerprint(client) {
  const result = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    const delegate = client[model.name[0].toLowerCase() + model.name.slice(1)];
    const identity = model.fields.filter(field => field.isId).map(field => field.name);
    if (model.primaryKey) identity.push(...model.primaryKey.fields);
    const selected = model.fields.filter(field => identity.includes(field.name) || field.kind === "enum" || ["DateTime", "Int", "BigInt", "Float", "Decimal", "Boolean"].includes(field.type));
    const rows = await delegate.findMany({ take: 5, select: Object.fromEntries(selected.map(field => [field.name, true])),
      ...(identity.length ? { orderBy: identity.map(field => ({ [field]: "asc" })) } : {}) });
    result[model.name] = { count: await delegate.count(), sampleDigest: createHash("sha256").update(serialize(rows)).digest("hex") };
  }
  return result;
}
const legacy = new PrismaClient({ datasourceUrl: "file:" + working });
let before;
try { before = await fingerprint(legacy); } finally { await legacy.$disconnect(); }
const Candidate = validationClientClass(PrismaClient, "wal");
const candidate = new Candidate({ datasourceUrl: "file:" + working });
let runtime, integrity, foreignKeys;
const sentinel = "rollback verification";
try {
  runtime = { version: await candidate.$queryRawUnsafe("SELECT sqlite_version() AS version"), journalMode: await candidate.$queryRawUnsafe("PRAGMA journal_mode"), synchronous: await candidate.$queryRawUnsafe("PRAGMA synchronous") };
  assert.deepEqual(await fingerprint(candidate), before);
  const id = "wal-validation-" + randomUUID();
  const timestamp = new Date("2026-10-18T00:00:00.123Z");
  await assert.rejects(candidate.$transaction(async tx => {
    await tx.aiSetting.create({ data: { id, value: "isolated timestamp probe", updatedAt: timestamp } });
    const row = await tx.aiSetting.findUniqueOrThrow({ where: { id } });
    assert.equal(row.updatedAt.toISOString(), timestamp.toISOString());
    throw new Error(sentinel);
  }), { message: sentinel });
  assert.equal(await candidate.aiSetting.findUnique({ where: { id } }), null);
  integrity = await candidate.$queryRawUnsafe("PRAGMA integrity_check");
  foreignKeys = await candidate.$queryRawUnsafe("PRAGMA foreign_key_check");
  assert.deepEqual(integrity, [{ integrity_check: "ok" }]);
  assert.equal(foreignKeys.length, 0);
  assert.deepEqual(await fingerprint(candidate), before);
} finally { await candidate.$disconnect(); }
const reopened = new PrismaClient({ datasourceUrl: "file:" + working });
try { assert.deepEqual(await fingerprint(reopened), before); } finally { await reopened.$disconnect(); }
const result = { sourceOpenedReadOnly: true, pristineBackup: pristine, workingCopy: working, runtime, models: before, integrity, foreignKeyViolations: foreignKeys.length, timestampAndRollback: "passed", reopenedWithOriginalDriver: "passed" };
writeFileSync(join(directory, "report.json"), JSON.stringify(result, (_key, value) => typeof value === "bigint" ? Number(value) : value, 2));
console.log("Copy compatibility passed:", Object.keys(before).length, "models; integrity ok; foreign keys ok; timestamps and rollback ok.");
console.log("Report:", join(directory, "report.json"));
