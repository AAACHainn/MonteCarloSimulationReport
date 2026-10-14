import type { GateApprovalInput } from "./types";

export type EntryCheckDraft = { draftId: string; approval: GateApprovalInput | null };

/** Checks belong to a draft identity, even when another draft has identical prices. */
export function retainEntryCheckDraft(current: EntryCheckDraft | null, draftId: string | null): EntryCheckDraft | null {
  if (draftId === null) return null;
  return current?.draftId === draftId ? current : { draftId, approval: null };
}

/** Reloading strategies preserves checks only while the checklist version is unchanged. */
export function reconcileEntryCheckApproval(
  approval: GateApprovalInput | null,
  strategies: ReadonlyArray<{ id: string; checklistVersion: number; checklist: ReadonlyArray<{ id: string }> }>,
): GateApprovalInput | null {
  if (!approval) return null;
  const strategy = strategies.find((item) => item.id === approval.strategyId);
  if (!strategy || !strategy.checklist.length) return null;
  const validIds = new Set(strategy.checklist.map((item) => item.id));
  return {
    strategyId: strategy.id,
    checklistVersion: strategy.checklistVersion,
    checkedItemIds: strategy.checklistVersion === approval.checklistVersion
      ? [...new Set(approval.checkedItemIds)].filter((id) => validIds.has(id)) : [],
  };
}
