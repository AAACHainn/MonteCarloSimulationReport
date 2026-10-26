import { Prisma, type UserGrowthFact } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { formatInteger, formatNumber } from "@/lib/format";
import { replayJournalTradeHref } from "@/lib/paper-trading/journal-links";
import { growthRealm, growthSegment, FOUNDATION_REQUIREMENTS, emptyGrowthTotals } from "./rules";
import { realmLabel, type SessionGrowthView } from "./presentation";
import type { GrowthProfile, GrowthRecord, GrowthRecordPage } from "./types";
import type { GrowthSource } from "./settlement";
const t = copy.userGrowth;
function dateText(value: Date) { return value.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replaceAll("/", "-"); }
function sourceSummary(raw: string): Partial<GrowthSource> { try { return JSON.parse(raw) ?? {}; } catch { return {}; } }
async function recordViews(tx: Prisma.TransactionClient, rows: UserGrowthFact[]): Promise<GrowthRecord[]> {
  const sessions = await tx.replaySession.findMany({ where: { id: { in: [...new Set(rows.map(row => row.sessionId).filter(Boolean))] } }, select: { id: true, datasetId: true, accountCategory: true } });
  return Promise.all(rows.map(async row => {
    const summary = sourceSummary(row.sourceSummary), session = sessions.find(item => item.id === row.sessionId);
    const achieved = row.type === "BREAKTHROUGH";
    const round = row.roundNumber ? t.roundLabel(formatInteger(row.roundNumber)) : t.training;
    const detail = achieved ? t.recordBreakthroughDetail : row.type === "PAYOUT" ? t.payoutContribution(round, row.sourceSummary && summary.currency !== "USDT" ? t.nonUsdtExcluded : `${formatNumber(Number(row.receivedUsdtMinorDelta) / 100)} USDT`, row.xpDelta > 0)
      : t.factContribution(row.type === "CYCLE" ? t.metricLabels[1] : row.type === "REVIEW" ? t.metricLabels[2] : t.metricLabels[3], round, row.type === "REVIEW" && summary.entryNo ? formatInteger(summary.entryNo) : "");
    let sourceUrl = session ? `/market-replay/${encodeURIComponent(session.datasetId)}/trade-history?sessionId=${encodeURIComponent(session.id)}${row.roundNumber && session.accountCategory === "PROP_PRACTICE" ? `&propRound=${row.roundNumber}` : ""}` : undefined;
    if (session && row.type === "REVIEW" && summary.journalSessionId && summary.entryNo) {
      const entry = await tx.replayJournalEntry.findFirst({ where: { journalSessionId: summary.journalSessionId, no: summary.entryNo, journalSession: { replaySessionId: session.id } }, select: { id: true } });
      sourceUrl = entry ? replayJournalTradeHref(session.datasetId, summary.journalSessionId, summary.entryNo) : undefined;
    }
    return { id: row.id, title: t.factTitles[row.type as keyof typeof t.factTitles] ?? t.historyRecords, xp: row.xpDelta, detail,
      settledAt: dateText(row.settledAt), replayAt: achieved ? copy.common.dash : dateText(row.occurredAt),
      source: achieved ? t.ruleVersion(row.ruleVersion) : `${summary.sessionName ?? t.sourceUnavailable} · ${summary.symbol ?? copy.common.dash}`,
      deleted: !achieved && !session, sourceUrl, ruleVersion: row.ruleVersion };
  }));
}
export async function readGrowthView(userId: string): Promise<Omit<GrowthProfile, "user" | "sessions">> {
  return prisma.$transaction(async tx => {
    const stored = await tx.userGrowth.findUnique({ where: { userId } });
    const totals = stored ?? emptyGrowthTotals();
    const current = growthRealm(totals.totalXp, stored?.realm === "FOUNDATION"), segment = growthSegment(totals.totalXp, current.realm === "FOUNDATION");
    const [facts, count, attained] = await Promise.all([
      tx.userGrowthFact.findMany({ where: { userId }, orderBy: [{ settledAt: "desc" }, { id: "desc" }], take: 5 }),
      tx.userGrowthFact.count({ where: { userId } }), tx.userRealmRecord.findUnique({ where: { userId_toRealm: { userId, toRealm: "FOUNDATION" } } }),
    ]);
    return { realm: current.realm === "MORTAL" ? "mortal" : current.realm === "QI" ? "qi" : "foundation", layer: current.layer, totalXp: totals.totalXp,
      segment: segment ? { value: segment.value, max: segment.max, next: segment.nextLayer > 12 ? t.foundationOne : realmLabel("QI", segment.nextLayer) } : undefined,
      attainedAt: attained ? dateText(attained.attainedAt) : undefined,
      conditions: (Object.keys(FOUNDATION_REQUIREMENTS) as Array<keyof typeof FOUNDATION_REQUIREMENTS>).map(key => ({ value: key === "receivedUsdtMinor" ? Number(totals[key]) / 100 : Number(totals[key]), target: key === "receivedUsdtMinor" ? Number(FOUNDATION_REQUIREMENTS[key]) / 100 : Number(FOUNDATION_REQUIREMENTS[key]) })),
      records: await recordViews(tx, facts), recordCount: count };
  });
}
/** SQLite append-only rowid watermark fences insertions while offset pages retain navigation to first/last. */
export async function readGrowthRecords(userId: string, requestedPage = 1, snapshot?: number): Promise<GrowthRecordPage> {
  return prisma.$transaction(async tx => {
    const [watermark] = await tx.$queryRaw<Array<{ value: bigint | number }>>`SELECT COALESCE(MAX(rowid), 0) AS value FROM UserGrowthFact WHERE userId=${userId}`;
    const anchor = snapshot === undefined ? Number(watermark.value) : Math.min(snapshot, Number(watermark.value));
    const [size] = await tx.$queryRaw<Array<{ value: bigint | number }>>`SELECT COUNT(*) AS value FROM UserGrowthFact WHERE userId=${userId} AND rowid<=${anchor}`;
    const total = Number(size.value), pageSize = 20;
    const page = Math.min(Math.max(1, Math.floor(requestedPage)), Math.max(1, Math.ceil(total / pageSize)));
    const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM UserGrowthFact WHERE userId=${userId} AND rowid<=${anchor} ORDER BY settledAt DESC,id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
    const rows = ids.length ? await tx.userGrowthFact.findMany({ where: { userId, id: { in: ids.map(row => row.id) } }, orderBy: [{ settledAt: "desc" }, { id: "desc" }] }) : [];
    return { items: await recordViews(tx, rows), page, pageSize, total, snapshot: anchor };
  });
}
export async function readSessionGrowth(tx: Prisma.TransactionClient, sessionId: string): Promise<SessionGrowthView | null> {
  const session = await tx.replaySession.findUnique({ where: { id: sessionId }, select: { userId: true, mode: true, growthEligible: true, user: { select: { nickname: true, growth: true } } } });
  const growth = session?.user?.growth;
  if (!session?.userId || !session.growthEligible || session.mode !== "TRAINING" || !growth) return null;
  const current = growthRealm(growth.totalXp, growth.realm === "FOUNDATION");
  return { userId: session.userId, nickname: session.user!.nickname, totalXp: growth.totalXp, version: growth.version, realmLabel: realmLabel(current.realm, current.layer) };
}
