import { resolve } from "node:path";
import { realpathSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { saveProfile } from "@/lib/user-growth/service";
import { createReplaySession } from "@/lib/replay-sessions/service";
import { defaultPropRules } from "@/lib/prop-practice/rules";
import { savePropTemplate } from "@/lib/prop-practice/service";
import { POST as createAccount } from "@/app/api/market-datasets/[id]/paper-session/route";
import { sqliteWriteTransaction } from "@/lib/sqlite-write";
import { writeWalletEntry } from "@/lib/user-wallet/service";

async function main() {
  const [connected] = await prisma.$queryRawUnsafe<Array<{ file: string }>>("PRAGMA database_list");
  if (realpathSync(connected.file) !== realpathSync(resolve("tmp/user-wallet/acceptance.db"))) throw new Error("Seed only runs against the isolated acceptance database.");
  if (await prisma.userProfile.count()) throw new Error("Seed refuses to overwrite existing acceptance users.");
  const users = await Promise.all(["余额验收·资金存取", "余额验收·费用不足", "余额验收·零余额"].map(nickname => saveProfile({ nickname })));
  const start = Date.parse("2026-10-01T00:00:00Z"), datasetId = "user-wallet-synthetic";
  await prisma.marketDataset.create({ data: { id: datasetId, name: "用户余额·合成验收行情", symbol: "TEST", timeframe: "1m", timezone: "UTC", sourceIntervalSeconds: 60, barCount: 180, startTime: new Date(start), endTime: new Date(start + 179 * 60000) } });
  await prisma.marketBar.createMany({ data: Array.from({ length: 180 }, (_, sequence) => ({ datasetId, sequence, timestamp: new Date(start + sequence * 60000), open: 100 + sequence, high: 102 + sequence, low: 99 + sequence, close: 101 + sequence, volume: 100 })) });
  const input = { timestamp: new Date(start).toISOString(), playbackRate: 1, displayIntervalSeconds: 60, displaySession: "ETH" as const, mode: "TRAINING" as const };
  async function standard(userId: string | null, name: string, capital: number, mode: "TRAINING" | "LIVE_REPLAY" = "TRAINING") {
    const session = await createReplaySession(datasetId, { ...input, userId, name, mode });
    const request = new Request(`http://localhost/api/test?replaySessionId=${session.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Replay-Projection": session.activeProjectionId }, body: JSON.stringify({ accountCategory: "STANDARD", currency: "USDT", initialCapital: capital, commissionBps: 0, slippageBps: 0 }) });
    const response = await createAccount(request, { params: Promise.resolve({ id: datasetId }) });
    if (response.status !== 201) throw new Error(JSON.stringify(await response.json()));
    return session;
  }
  const own = await standard(users[0].id, "自有资金·存入3000", 3000);
  await prisma.paperTradingSession.update({ where: { projectionId: own.activeProjectionId }, data: { realizedPnl: 250, totalFees: 5 } });
  await standard(users[1].id, "自有资金·占用9000", 9000);
  await sqliteWriteTransaction(prisma, tx => writeWalletEntry(tx, { userId: users[2].id, type: "PURCHASE", sourceKey: "acceptance-zero", amountMinor: BigInt(-1_000_000), sessionName: "合成样例·购买费用耗尽余额" }));
  await standard(users[0].id, "实盘重演·不占用户余额", 100000, "LIVE_REPLAY");
  await standard(null, "未归属·不占用户余额", 100000);
  const rules = structuredClone(defaultPropRules); rules.name = "余额验收·购买500激活2000"; rules.purchaseCost = 500; rules.activationCost = 2000; rules.evaluation.minTradingDays = null; rules.evaluation.consistency = null;
  const template = await savePropTemplate(rules);
  const prop = await createReplaySession(datasetId, { ...input, userId: users[0].id, name: "自营公司·已扣购买费500", accountCategory: "PROP_PRACTICE", propTemplateVersionId: template.versions[0].id, propAccountConfig: { currency: "USDT", commissionBps: 0, slippageBps: 0 } });
  const report = { database: connected.file, users: users.map(user => ({ id: user.id, nickname: user.nickname })), datasetId, sessions: { standard: own.id, prop: prop.id }, url: "http://localhost:3105/users" };
  writeFileSync("tmp/user-wallet/acceptance.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().finally(() => prisma.$disconnect());
