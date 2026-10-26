import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { createDatabaseClient } = await import("@/lib/sqlite-client.mjs");
  const { randomUUID } = await import("node:crypto"), { join } = await import("node:path"), { tmpdir } = await import("node:os");
  return { prisma: createDatabaseClient({ datasourceUrl: `file:${join(tmpdir(), `user-ownership-${randomUUID()}.db`)}` }, { allowCreate: true }), replayDatabaseQueryCount: () => null };
});
import { prisma } from "@/lib/db";
import { createReplaySession, restartReplaySession } from "@/lib/replay-sessions/service";
import { loadReplayScope, runWithReplayScope } from "@/lib/replay-sessions/scope";
import { listReplaySessions } from "@/lib/replay-sessions/read";
import { saveProfile, sessionPage, profileInput } from "./service";
import { POST as createUser } from "@/app/api/users/route";
import { GET as readProfile } from "@/app/api/users/[userId]/route";
import { inheritSessionOwnership, newSessionOwnership } from "./ownership";
import { savePropTemplate } from "@/lib/prop-practice/service";
import { resetPropAccount } from "@/lib/prop-practice/rounds";
import { defaultPropRules } from "@/lib/prop-practice/rules";
import { randomUUID } from "node:crypto";
let file = "";
const timestamp = "2026-10-01T00:00:00.000Z";
beforeAll(async () => {
  file = (await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list"))[0].file;
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
  await prisma.marketDataset.create({ data: { id: "shared", name: "Shared", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: 3, startTime: new Date(timestamp), endTime: new Date(Date.parse(timestamp) + 120_000) } });
  await prisma.marketBar.createMany({ data: [0, 1, 2].map(sequence => ({ datasetId: "shared", sequence, timestamp: new Date(Date.parse(timestamp) + sequence * 60000), open: 100, high: 102, low: 99, close: 101 })) });
}, 30000);
afterAll(async () => { await prisma.$disconnect(); if (file.includes("user-ownership-")) rmSync(file, { force: true }); });
const context = (userId: string) => ({ params: Promise.resolve({ userId }) });
const post = (body: unknown) => new Request("http://192.168.1.2/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const create = (userId?: string | null, mode: "TRAINING" | "LIVE_REPLAY" = "TRAINING") => createReplaySession("shared", { name: "训练", userId, mode, timestamp, playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" });

describe("real profiles and fixed ownership", () => {
  it("validates trimmed unicode nicknames, uniqueness and strict request fields", async () => {
    expect(profileInput.parse({ nickname: "  测试甲  " }).nickname).toBe("测试甲");
    expect(profileInput.safeParse({ nickname: "😀".repeat(24) }).success).toBe(true);
    expect(profileInput.safeParse({ nickname: "😀".repeat(25) }).success).toBe(false);
    expect(profileInput.safeParse({ nickname: " ", totalXp: 999 }).success).toBe(false);
    const result = await createUser(post({ nickname: "  测试甲  " })); expect(result.status).toBe(201);
    const user = (await result.json()).user;
    expect((await prisma.userGrowth.findUniqueOrThrow({ where: { userId: user.id } })).totalXp).toBe(0);
    expect((await createUser(post({ nickname: "测试甲" }))).status).toBe(409);
    const edited = await saveProfile({ nickname: "测试甲改名" }, user.id); expect(edited.id).toBe(user.id);
    expect((await readProfile(new Request("http://local/api/profile"), context(user.id))).status).toBe(200);
    expect((await readProfile(new Request("http://local/api/profile"), context("missing"))).status).toBe(404);
  });
  it("keeps shared data accessible and rejects missing owners instead of silently unassigning", async () => {
    const a = await saveProfile({ nickname: "归属甲" }), b = await saveProfile({ nickname: "归属乙" });
    const owned = await create(a.id), global = await create(), replay = await create(b.id, "LIVE_REPLAY");
    expect(owned).toMatchObject({ userId: a.id, growthEligible: true });
    expect(global).toMatchObject({ userId: null, growthEligible: false });
    expect(replay).toMatchObject({ userId: b.id, growthEligible: false });
    const count = await prisma.replaySession.count(); await expect(create("missing-user")).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(await prisma.replaySession.count()).toBe(count);
    expect((await listReplaySessions("shared", a.id)).map(row => row.id)).toEqual([owned.id]);
    expect((await listReplaySessions("shared")).some(row => row.id === replay.id)).toBe(true);
    expect((await loadReplayScope(owned.id)).id).toBe(owned.id); // direct lookup has no user authorization filter
    expect(await prisma.marketDataset.count()).toBe(1);
    await saveProfile({ nickname: "归属甲更名" }, a.id);
    expect((await listReplaySessions("shared", a.id))[0].owner?.nickname).toBe("归属甲更名");
  });
  it.each(["growth", "unassigned", "replay"])("restart inherits %s regardless of submitted browser user", async kind => {
    const a = await saveProfile({ nickname: `继承甲${kind}` }), b = await saveProfile({ nickname: `继承乙${kind}` });
    const source = await create(kind === "growth" || kind === "replay" ? a.id : null, kind === "replay" ? "LIVE_REPLAY" : "TRAINING");
    const original = await prisma.replaySession.findUniqueOrThrow({ where: { id: source.id } });
    const next = await runWithReplayScope(await loadReplayScope(source.id), () => restartReplaySession({ name: "重新开始", userId: b.id, mode: original.mode as "TRAINING" | "LIVE_REPLAY", timestamp, playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" }));
    expect(next).toMatchObject({ userId: original.userId, growthEligible: original.growthEligible });
    expect((await prisma.replaySession.findUniqueOrThrow({ where: { id: source.id } })).status).toBe("ARCHIVED");
    expect(await prisma.userGrowthFact.count()).toBe(0);
  });
  it("bounds personal paging and filters without granting ownership", async () => {
    const a = await saveProfile({ nickname: "分页甲" });
    for (let i = 0; i < 23; i++) await create(a.id);
    const first = await sessionPage(new URLSearchParams("page=1"), a.id), last = await sessionPage(new URLSearchParams("page=99999"), a.id);
    expect(first.items).toHaveLength(20); expect(first.total).toBe(23); expect(last.page).toBe(2); expect(last.items).toHaveLength(3);
    expect(new Set([...first.items, ...last.items].map(item => item.id)).size).toBe(23);
    expect((await sessionPage(new URLSearchParams("mode=replay"), a.id)).total).toBe(0);
    expect((await sessionPage(new URLSearchParams("search=不存在"), a.id)).total).toBe(0);
  });
  it.each(["growth", "unassigned"])("same-session re-exam retains %s ownership and eligibility", async kind => {
    const a = await saveProfile({ nickname: `考核甲${kind}` });
    const template = await savePropTemplate({ ...structuredClone(defaultPropRules), name: `归属测试${kind}` });
    const source = await createReplaySession("shared", { name: "自营继承", userId: kind === "growth" ? a.id : null, mode: "TRAINING", timestamp, playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH", accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id, propAccountConfig: { currency: "USDT", commissionBps: 0, slippageBps: 0 } });
    const original = await prisma.replaySession.findUniqueOrThrow({ where: { id: source.id } });
    const prop = await prisma.propPracticeAccount.findUniqueOrThrow({ where: { replaySessionId: source.id } });
    await prisma.propPracticeAccount.update({ where: { replaySessionId: source.id }, data: { state: JSON.stringify({ ...JSON.parse(prop.state), result: "FAILED" }) } });
    const scope = await loadReplayScope(source.id);
    const input = { expectedVersion: scope.version, expectedProjectionId: scope.projectionId, requestId: randomUUID() };
    const next = await runWithReplayScope(scope, () => resetPropAccount(input)); expect(next.number).toBe(2);
    const result = await prisma.replaySession.findUniqueOrThrow({ where: { id: source.id } });
    expect(result).toMatchObject({ userId: original.userId, growthEligible: original.growthEligible });
    expect(await prisma.userGrowthFact.count()).toBe(0);
  });
  it("reserves independent source keys, settled deltas and realm idempotency even after deleting source", async () => {
    const user = await saveProfile({ nickname: "结构基础" }), source = await create(user.id);
    const fact = { userId: user.id, type: "TEST_FOUNDATION", sourceKey: `test:${source.id}`, sessionId: source.id, sourceSummary: "test-only", occurredAt: new Date(), xpDelta: 5, cyclesDelta: 1, ruleVersion: "test-only-v1" };
    await prisma.userGrowthFact.create({ data: fact });
    await expect(prisma.userGrowthFact.create({ data: fact })).rejects.toMatchObject({ code: "P2002" });
    await prisma.replaySession.delete({ where: { id: source.id } });
    expect((await prisma.userGrowthFact.findUniqueOrThrow({ where: { sourceKey: fact.sourceKey } })).xpDelta).toBe(5);
    await prisma.userRealmRecord.create({ data: { userId: user.id, fromRealm: "QI", toRealm: "FOUNDATION", metricsSnapshot: "{}", ruleVersion: "test-only-v1", idempotencyKey: "test-realm" } });
    await expect(prisma.userRealmRecord.create({ data: { userId: user.id, fromRealm: "QI", toRealm: "FOUNDATION", metricsSnapshot: "{}", ruleVersion: "test-only-v1", idempotencyKey: "test-realm-other" } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("keeps unowned restarts and live replay derivatives ineligible", () => {
    expect(newSessionOwnership(null, "TRAINING").growthEligible).toBe(false);
    const unowned = newSessionOwnership(null, "TRAINING");
    expect(inheritSessionOwnership(unowned, "TRAINING").growthEligible).toBe(false);
    expect(inheritSessionOwnership({ userId: "a", growthEligible: true }, "LIVE_REPLAY").growthEligible).toBe(false);
  });
});
