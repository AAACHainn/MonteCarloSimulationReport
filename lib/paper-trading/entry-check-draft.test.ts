import { describe, expect, it } from "vitest";
import { reconcileEntryCheckApproval, retainEntryCheckDraft } from "./entry-check-draft";
import type { GateApprovalInput } from "./types";

const strategy = { id: "trend", checklistVersion: 3, checklist: [{ id: "direction" }, { id: "risk" }] };
const approval: GateApprovalInput = { strategyId: strategy.id, checklistVersion: 3, checkedItemIds: ["direction"] };

describe("entry checklist draft memory", () => {
  it("retains a partially checked strategy when reopening the same draft", () => {
    const current = { draftId: "draft-one", approval };
    const reopened = retainEntryCheckDraft(current, "draft-one");
    expect(reopened).toBe(current);
    expect(reconcileEntryCheckApproval(reopened!.approval, [strategy])).toEqual(approval);
  });

  it("discards checks when the draft is cancelled, and starts a new order empty", () => {
    const cancelled = retainEntryCheckDraft({ draftId: "draft-one", approval }, null);
    expect(cancelled).toBeNull();
    expect(retainEntryCheckDraft(cancelled, "draft-two")).toEqual({ draftId: "draft-two", approval: null });
  });

  it("does not reuse approval for a replacement order, even with the same economics", () => {
    expect(retainEntryCheckDraft({ draftId: "draft-one", approval }, "draft-two")).toEqual({ draftId: "draft-two", approval: null });
  });

  it("preserves a completed checklist on reopen without mutating its saved approval", () => {
    const completed = { ...approval, checkedItemIds: ["direction", "risk"] };
    const restored = reconcileEntryCheckApproval(completed, [strategy]);
    expect(restored).toEqual(completed);
    expect(restored!.checkedItemIds).not.toBe(completed.checkedItemIds);
  });

  it("keeps the selected strategy but clears checks when its version changes", () => {
    const updated = { ...strategy, checklistVersion: 4, checklist: [...strategy.checklist, { id: "context" }] };
    expect(reconcileEntryCheckApproval(approval, [updated])).toEqual({ strategyId: "trend", checklistVersion: 4, checkedItemIds: [] });
    expect(approval.checkedItemIds).toEqual(["direction"]);
  });

  it("clears an unavailable strategy or a strategy whose checklist was removed", () => {
    expect(reconcileEntryCheckApproval(approval, [])).toBeNull();
    expect(reconcileEntryCheckApproval(approval, [{ ...strategy, checklist: [] }])).toBeNull();
  });

  it("ignores stale and duplicate item IDs instead of treating them as checked items", () => {
    expect(reconcileEntryCheckApproval({ ...approval, checkedItemIds: ["direction", "direction", "removed"] }, [strategy])?.checkedItemIds).toEqual(["direction"]);
  });

  it("does not choose a strategy automatically for a fresh draft", () => {
    expect(reconcileEntryCheckApproval(null, [strategy])).toBeNull();
  });
});
