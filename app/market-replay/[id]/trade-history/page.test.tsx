import React from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";

const mocks = vi.hoisted(() => ({ dataset: vi.fn(), sessions: vi.fn(), scope: vi.fn(), roundScope: vi.fn(), rounds: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { marketDataset: { findUnique: mocks.dataset } } }));
vi.mock("@/lib/replay-sessions/read", () => ({ listReplaySessions: mocks.sessions }));
vi.mock("@/lib/replay-sessions/scope", () => ({ loadReplayScope: mocks.scope, loadPropRoundScope: mocks.roundScope, runWithReplayScope: (_scope: unknown, work: () => unknown) => work() }));
vi.mock("@/lib/prop-practice/rounds", () => ({ listPropRounds: mocks.rounds }));
vi.mock("@/lib/paper-trading/serialize", () => ({ getPaperSessionSnapshot: mocks.snapshot }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/components/market-replay/replay-session-entry-guard", () => ({ ReplaySessionGate: "session-gate" }));
vi.mock("@/components/market-replay/replay-session-context", () => ({ ReplaySessionProvider: "session-provider" }));
vi.mock("@/components/user-growth/user-context-header", () => ({ UserContextHeader: "session-header" }));
vi.mock("@/components/user-growth/ownership-context", () => ({ OwnershipContext: "ownership-context" }));
vi.mock("@/components/user-growth/user-entry", () => ({ UserEntry: "user-entry" }));
vi.mock("@/components/breadcrumbs", () => ({ Breadcrumbs: "breadcrumbs" }));
vi.mock("@/components/market-replay/paper-journal-table", () => ({ PaperJournalTable: "journal-table" }));
vi.mock("@/components/market-replay/prop-round-history", () => ({ PropRoundHistory: "round-history", PropRoundTradingRecords: "round-records" }));
vi.mock("@/components/market-replay/prop-account-panel", () => ({ PropAccountPanel: "prop-account" }));
import Page from "./page";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as Element;
  return element.props ? [element, ...elements(element.props.children)] : [];
}
const session = { id: "session-b", datasetId: "market", name: "Owner B", userId: "user-b", owner: { id: "user-b", nickname: "B" }, activeProjectionId: "current-projection", status: "ACTIVE", accountCategory: "PROP_PRACTICE" } as ReplaySessionSummary;
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataset.mockResolvedValue({ id: "market", name: "Market", symbol: "TEST" });
  mocks.sessions.mockResolvedValue([session]);
  mocks.scope.mockResolvedValue({ id: session.id, projectionId: session.activeProjectionId });
  mocks.roundScope.mockImplementation(async (scope, number) => ({ ...scope, projectionId: number ? "old-round-projection" : scope.projectionId }));
  mocks.rounds.mockResolvedValue([{ number: 1 }]);
  mocks.snapshot.mockResolvedValue(null);
});

describe("trade history ownership entry", () => {
  it("obtains entry consent before mounting the journal for direct and growth-source links", async () => {
    const tree = await Page({ params: Promise.resolve({ id: "market" }), searchParams: Promise.resolve({ sessionId: session.id }) });
    expect(tree.type).toBe("session-gate");
    expect(tree.props.session).toBe(session);
    const header = elements(tree).find(element => element.type === "session-header");
    expect(header?.props.session).toBe(session);
    expect(elements(tree).some(element => element.type === "ownership-context")).toBe(false);
  });

  it("checks the base session while the provider keeps the selected archived prop round", async () => {
    const tree = await Page({ params: Promise.resolve({ id: "market" }), searchParams: Promise.resolve({ sessionId: session.id, propRound: "1" }) });
    expect(tree.type).toBe("session-gate");
    expect(tree.props.session).toMatchObject({ activeProjectionId: "current-projection", userId: "user-b" });
    const provider = elements(tree).find(element => element.type === "session-provider");
    expect(provider?.props.session).toMatchObject({ activeProjectionId: "old-round-projection", propRoundNumber: 1 });
  });
});
