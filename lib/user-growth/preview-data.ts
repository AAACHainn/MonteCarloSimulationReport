import { copy } from "@/lib/i18n";
import type { GrowthProfile, GrowthRecord, GrowthRecordPage, ProfileSession, UserIdentity } from "./types";

const t = copy.userGrowth;
export const previewAvatar = { preset: 0, zoom: 1, x: 50, y: 50 };
export const previewUsers: UserIdentity[] = t.demoPeople.map((nickname, i) => ({ id: `demo-${i}`, nickname, avatar: { ...previewAvatar, preset: i }, realmLabel: [t.qiLayer(t.layerNames[11]), t.mortal, t.qiLayer(t.layerNames[5])][i] }));
export const previewHistory: ProfileSession[] = t.fixtureSessions.map((name, i) => ({ id: `history-${i}`, name, market: i % 2 ? "BTCUSDT · 5m" : "NQ · 1m", mode: i === 4 ? "replay" : "training", account: i % 2 ? "default" : "prop", trades: 16 + i * 9, created: `2026-10-${20 + i} 10:30`, eligibility: "historical" }));

/** Simulates a paginated source: generates at most one page, never a 5,000-item array. */
export function makePreviewRecordPage(scenario: number, requestedPage: number, breakthrough = false): GrowthRecordPage {
  const seeds: GrowthRecord[] = scenario === 0 ? [] : t.fixtureRecords.slice(0, scenario === 1 ? 2 : undefined).map((title, i) => ({ id: `record-${i}`, title, xp: [10, 5, 0, 100, 10, 5][i], detail: t.fixtureDetails[i], settledAt: `2026-10-${25 - i} 14:30`, replayAt: "2025-06-12 09:45", source: `${t.fixtureSources[i]} · ${i % 2 ? "BTCUSDT" : "NQ"}`, deleted: i === 1 }));
  const achievement: GrowthRecord = { id: "breakthrough-demo", title: t.recordBreakthrough, xp: 0, detail: t.recordBreakthroughDetail, settledAt: "2026-10-25 15:00", replayAt: copy.common.dash, source: t.previewBadge };
  const pageSize = 20;
  const total = (scenario === 8 ? 5000 : seeds.length) + (breakthrough ? 1 : 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * pageSize;
  const items = Array.from({ length: Math.min(pageSize, Math.max(0, total - start)) }, (_, offset) => {
    const index = start + offset;
    if (breakthrough && index === 0) return achievement;
    const seedIndex = index - (breakthrough ? 1 : 0);
    if (seedIndex < seeds.length) return seeds[seedIndex];
    const seed = seeds[seedIndex % seeds.length];
    // Fixed Beijing wall-clock strings for synthetic older records, ordered newest first.
    const settledAt = new Date(Date.UTC(2026, 9, 20, 14, 30) - (seedIndex - seeds.length + 1) * 60_000).toISOString().slice(0, 16).replace("T", " ");
    return { ...seed, id: `record-${seedIndex}`, settledAt };
  });
  return { items, page, pageSize, total };
}

/** Fixed design fixtures, deliberately separate from future business rules. V1 proposed thresholds. */
export function makePreviewProfile(user: UserIdentity, scenario: number): GrowthProfile {
  const totals = [0, 95, 3670, 16500, 19300, 19300, 21100, 1288500, 1288500];
  const totalXp = totals[scenario] ?? totals[3];
  const realm = scenario < 2 ? "mortal" : scenario === 6 ? "foundation" : "qi";
  const layer = realm === "qi" ? scenario === 2 ? 6 : 12 : realm === "foundation" ? 1 : 0;
  const realmLabel = realm === "mortal" ? t.mortal : realm === "foundation" ? t.foundationOne : t.qiLayer(t.layerNames[layer - 1]);
  const values = scenario < 2 ? [totalXp, scenario ? 9 : 0, scenario ? 5 : 0, 0, 0, 0] : scenario === 2 ? [totalXp, 420, 205, 4, 2, 12500] : scenario < 5 ? [totalXp, 1350, 620, 18, 10, 92000] : scenario >= 7 ? [totalXp, 128501, 64312, 1302, 960, 125650000.25] : [totalXp, 1420, 680, 22, 12, 108200];
  const recordPage = makePreviewRecordPage(scenario, 1);
  return {
    user: { ...user, nickname: scenario === 7 && previewUsers.some((u) => u.id === user.id && u.nickname === user.nickname) ? t.longName : user.nickname, realmLabel }, realm, layer, totalXp, attainedAt: realm === "foundation" ? "2026-10-25" : undefined,
    segment: realm === "foundation" ? undefined : realm === "mortal" ? { value: totalXp, max: 100, next: t.qiLayer(t.layerNames[0]) } : scenario === 2 ? { value: 570, max: 1050, next: t.qiLayer(t.layerNames[6]) } : { value: totalXp - 13600, max: 4500, next: t.foundationOne },
    conditions: [18100, 1200, 600, 20, 10, 100000].map((target, i) => ({ target, value: values[i] })),
    records: recordPage.items.slice(0, 5), recordCount: recordPage.total,
    sessions: scenario === 0 ? [] : previewHistory.slice(0, scenario === 1 ? 1 : 3).map((session, i) => ({ ...session, id: `session-${i}`, name: t.fixtureCurrentSessions[i], eligibility: i === 0 ? "growth" : i === 1 ? "historical" : "replay", mode: i === 2 ? "replay" : "training" })),
  };
}
