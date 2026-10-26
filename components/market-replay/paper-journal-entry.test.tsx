import React from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const rt = vi.hoisted(() => ({ controller: {} as Record<string, unknown>, open: vi.fn(), push: vi.fn(), busy: false }));
vi.mock("@/components/user-growth/user-context", () => ({ useCurrentUser: () => ({ selectedId: null }) }));
vi.mock("./use-paper-journal-table-controller", () => ({ usePaperJournalTableController: () => rt.controller }));
vi.mock("./replay-session-entry-guard", () => ({ useReplaySessionEntry: () => ({ open: rt.open, busy: rt.busy, ui: React.createElement("entry-feedback") }) }));
vi.mock("@/components/ui/select", () => ({ Select: "session-select", SelectContent: "select-content", SelectItem: "select-item", SelectTrigger: "select-trigger", SelectValue: "select-value" }));
import { PaperJournalTable } from "./paper-journal-table";

type Element = { type: unknown; props: Record<string, unknown> };
function all(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as Element;
  return element.props ? [element, ...all(element.props.children)] : [];
}
const sessions = [{ id: "a", name: "A", mode: "TRAINING", status: "ACTIVE", createdAt: "2026-10-01T00:00:00Z", userId: "owner-a" }, { id: "b", name: "B", mode: "TRAINING", status: "ACTIVE", createdAt: "2026-10-01T00:00:00Z", userId: "owner-b" }] as const;
function tree() { return PaperJournalTable({ datasetId: "market", scope: "history", replaySessions: [...sessions] }); }
function select(node: unknown) { return all(node).find(element => element.type === "session-select")!.props as { onValueChange: (id: string) => void; disabled: boolean }; }
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  rt.open.mockReset(); rt.open.mockResolvedValue(undefined); rt.push.mockReset(); rt.busy = false;
  rt.controller = { replaySession: sessions[0], router: { push: rt.push }, switchingSession: false, startSessionNavigation: (work: () => void) => work(), items: [], sessions: [], loading: true, renaming: false, savingSetupIds: new Set(), savingTradeReasonIds: new Set(), savingReviewIds: new Set() };
});
describe("journal session navigation consent", () => {
  it("does not navigate until the shared entry flow confirms the target owner", () => {
    const view = tree(); select(view).onValueChange("b");
    expect(rt.push).not.toHaveBeenCalled();
    expect(rt.open).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "b", onEnter: expect.any(Function) }));
    expect(all(view).some(element => element.type === "entry-feedback")).toBe(true);
    const request = rt.open.mock.calls[0][0] as { onEnter: () => void };
    request.onEnter();
    expect(rt.push).toHaveBeenCalledWith("/market-replay/market/trade-history?sessionId=b");
  });
  it("keeps the current selection inert and prevents a second selection while checking", () => {
    select(tree()).onValueChange("a"); expect(rt.open).not.toHaveBeenCalled();
    rt.busy = true; expect(select(tree()).disabled).toBe(true);
  });
});
