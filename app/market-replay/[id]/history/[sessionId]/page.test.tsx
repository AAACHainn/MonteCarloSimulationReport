import React from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dataset: vi.fn(), sessions: vi.fn(), journal: vi.fn(), entry: vi.fn(), bounds: vi.fn(), round: vi.fn(), projection: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  marketDataset: { findUnique: mocks.dataset }, replayJournalSession: { findFirst: mocks.journal },
  replayJournalEntry: { aggregate: mocks.bounds, findFirst: mocks.entry },
  propPracticeRound: { findUnique: mocks.round }, replayProjection: { findUniqueOrThrow: mocks.projection },
} }));
vi.mock("@/lib/replay-sessions/read", () => ({ listReplaySessions: mocks.sessions }));
vi.mock("@/lib/paper-trading/journal-numbering", () => ({ withReplayJournalDisplayNumbers: async (entries: unknown) => entries }));
vi.mock("@/lib/market-replay/serialize", () => ({ serializeMarketDataset: (dataset: unknown) => dataset }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/components/market-replay/replay-session-entry-guard", () => ({ ReplaySessionGate: "session-gate" }));
vi.mock("@/components/market-replay/replay-session-context", () => ({ ReplaySessionProvider: "session-provider" }));
vi.mock("@/components/user-growth/user-context-header", () => ({ UserContextHeader: "session-header" }));
vi.mock("@/components/breadcrumbs", () => ({ Breadcrumbs: "breadcrumbs" }));
vi.mock("@/components/market-replay/historical-replay-client", () => ({ HistoricalReplayClient: "historical-chart" }));
import Page from "./page";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as Element;
  return element.props ? [element, ...elements(element.props.children)] : [];
}
const owner = { id: "owner", activeProjectionId: "current", status: "ACTIVE", progress: { currentSequence: 900 } };
const entry = { id: "trade", accountNo: 1, openedSequence: 100, displayIntervalSeconds: 300, displaySession: "ETH" };
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataset.mockResolvedValue({ id: "dataset", name: "test", symbol: "TEST", barCount: 1200, sessionMode: "TWENTY_FOUR_SEVEN", timezone: "UTC", tradingWeekdays: "1,2,3,4,5,6,7", sessionOpenMinute: null, sessionCloseMinute: null });
  mocks.sessions.mockResolvedValue([owner]);
  mocks.journal.mockResolvedValue({ id: "journal", replaySessionId: owner.id, replayGeneration: 1 });
  mocks.entry.mockResolvedValue(entry);
  mocks.bounds.mockResolvedValue({ _min: { openedSequence: 100 }, _max: { closedSequence: 500 } });
  mocks.round.mockResolvedValue(null);
  mocks.projection.mockResolvedValue({ currentSequence: 900 });
});
async function page(query = {}) {
  const tree = await Page({ params: Promise.resolve({ id: "dataset", sessionId: "journal" }), searchParams: Promise.resolve(query) });
  const nodes = elements(tree);
  return { chart: nodes.find(element => element.type === "historical-chart")!, provider: nodes.find(element => element.type === "session-provider")! };
}

describe("historical page playback bounds and read-only scope", () => {
  it("extends past the last closed trade to this session's practised flat tail", async () => {
    const { chart, provider } = await page();
    expect(chart.props.session).toMatchObject({ startSequence: 100, endSequence: 900 });
    expect(chart.props.focusSequence).toBe(100);
    expect(provider.props.session).toMatchObject({ status: "ARCHIVED", activeProjectionId: "current" });
  });
  it("freezes a selected archived round at that round's endpoint", async () => {
    mocks.entry.mockImplementation(async ({ select }) => select.projectionId ? { projectionId: "old-round" } : entry);
    mocks.round.mockResolvedValue({ number: 1, endSequence: 600 });
    mocks.projection.mockResolvedValue({ currentSequence: 600 });
    const { chart, provider } = await page({ journalNo: "1" });
    expect(chart.props.session).toMatchObject({ endSequence: 600 });
    expect(provider.props.session).toMatchObject({ status: "ARCHIVED", activeProjectionId: "old-round", propRoundNumber: 1 });
    expect(mocks.projection).toHaveBeenCalledWith({ where: { id: "old-round" }, select: { currentSequence: true } });
  });
});
