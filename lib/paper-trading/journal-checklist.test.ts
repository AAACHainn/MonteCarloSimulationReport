import { describe, expect, it } from "vitest";
import { copy } from "@/lib/i18n";
import { journalSetupChecklist, journalSetupChecklistTitle, journalUsedChecklist } from "./journal-checklist";
import { journalColumnsForContext, parseJournalVisibleColumns } from "./journal-columns";
import type { EntryDiscipline } from "./training-gate";

const discipline: EntryDiscipline = {
  strategyId: "trend", strategyName: "顺势交易", checklistVersion: 1,
  checklist: [{ id: "context", text: "确认趋势方向" }, { id: "risk", text: "确认风险金额" }],
  confirmedAt: "2026-10-14T00:00:00.000Z",
};
const entry = { setupOptionId: "trend", setupOption: { name: "顺势交易" }, discipline };
const strategies = [{ id: "trend", name: "顺势交易", checklist: [{ id: "updated", text: "修改后的清单" }] }];

describe("journal checklist history", () => {
  it("marks an entry checked only when it has a submitted gate record", () => {
    expect(journalUsedChecklist(entry)).toBe(true);
    expect(journalUsedChecklist({ discipline: null })).toBe(false);
    expect(journalUsedChecklist({})).toBe(false);
  });

  it("keeps the original checks when the strategy checklist changes or is no longer available", () => {
    for (const options of [strategies, []]) {
      expect(journalSetupChecklist(entry, options)).toEqual({ name: "顺势交易", checklist: discipline.checklist, confirmed: true });
    }
  });

  it("lists the name and ordered historical items in the hover title", () => {
    const details = journalSetupChecklist(entry, strategies)!;
    expect(journalSetupChecklistTitle(details)).toBe(`顺势交易\n${copy.paperTrading.confirmedSetupChecklist}\n1. 确认趋势方向\n2. 确认风险金额`);
  });

  it("shows the current checklist for a manually assigned Setup without claiming gate approval", () => {
    const unchecked = { ...entry, discipline: null };
    const details = journalSetupChecklist(unchecked, strategies)!;
    expect(details).toEqual({ name: "顺势交易", checklist: strategies[0].checklist, confirmed: false });
    expect(journalUsedChecklist(unchecked)).toBe(false);
    expect(journalSetupChecklistTitle(details)).toContain(copy.trainingGate.checklist);
  });

  it("changing or clearing Setup does not change the original checklist-use flag", () => {
    const other = { id: "reversal", name: "反转交易", checklist: [{ id: "other", text: "确认反转结构" }] };
    const edited = { ...entry, setupOptionId: other.id, setupOption: { name: other.name } };
    expect(journalSetupChecklist(edited, [other])).toEqual({ name: other.name, checklist: other.checklist, confirmed: false });
    expect(journalUsedChecklist(edited)).toBe(true);
    expect(journalSetupChecklist({ ...edited, setupOptionId: null, setupOption: null }, [other])).toBeNull();
    expect(entry.discipline).toEqual(discipline);
  });

  it("reports unconfigured checklists without inventing approval or items", () => {
    const unchecked = { ...entry, discipline: null };
    expect(journalSetupChecklist(unchecked, [])).toBeNull();
    const details = journalSetupChecklist(unchecked, [{ id: "trend", name: "顺势交易" }])!;
    expect(journalSetupChecklistTitle(details)).toContain(copy.trainingGate.emptyChecklist);
    expect(details.confirmed).toBe(false);
  });
});

describe("journal column visibility", () => {
  it("includes checklist use in training history, including legacy training sessions", () => {
    expect(journalColumnsForContext("history", "TRAINING").map((column) => column.id)).toContain("checklistUsed");
    expect(journalColumnsForContext("history").map((column) => column.id)).toContain("checklistUsed");
  });

  it("hides the column from live replay and the current trading panel", () => {
    expect(journalColumnsForContext("history", "LIVE_REPLAY").map((column) => column.id)).not.toContain("checklistUsed");
    expect(journalColumnsForContext("current", "TRAINING").map((column) => column.id)).not.toContain("checklistUsed");
    expect(journalColumnsForContext("current", "TRAINING").map((column) => column.id)).not.toContain("review");
  });

  it("adds the new column once to old saved preferences while retaining other hidden columns", () => {
    expect(parseJournalVisibleColumns(JSON.stringify(["no", "setup", "review"]), true)).toEqual(["no", "setup", "checklistUsed", "review"]);
  });

  it("respects later decisions to hide checklist use or review", () => {
    expect(parseJournalVisibleColumns(JSON.stringify(["no", "setup"]))).toEqual(["no", "setup"]);
  });

  it("ignores duplicates and unknown fields and recovers invalid preferences", () => {
    expect(parseJournalVisibleColumns(JSON.stringify(["setup", "no", "unknown", "no"]))).toEqual(["no", "setup"]);
    for (const value of [null, "bad JSON", "{}", "[]", '["unknown"]']) {
      expect(parseJournalVisibleColumns(value)).toEqual(parseJournalVisibleColumns(null));
    }
  });
});
