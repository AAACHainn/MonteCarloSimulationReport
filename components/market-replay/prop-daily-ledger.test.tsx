import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TablePagination } from "@/components/ui/table-pagination";
import { copy } from "@/lib/i18n";
import { defaultPropRules, initialPropState, type PropDay, type PropStage } from "@/lib/prop-practice/rules";
import { PropDailyLedger } from "./prop-daily-ledger";

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[] }));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = next; }];
  },
  useMemo: (factory: () => unknown) => factory(),
}));

type Element = { type: unknown; props: Record<string, unknown> };
function all(node: unknown): Element[] {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as Element;
  if (element.type === TablePagination) return all(TablePagination(element.props as React.ComponentProps<typeof TablePagination>));
  return [element, ...all(element.props?.children)];
}
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node && typeof node === "object" ? textOf((node as Element).props?.children) : "";
}
function day(index: number, rest: Partial<PropDay> = {}): PropDay {
  return { day: new Date(Date.UTC(2026, 0, index)).toISOString(), startRawNet: 0, endRawNet: index, balance: 50000 + index, settled: true, traded: true, ...rest };
}
function stage(days: PropDay[], kind: PropStage["kind"] = "EVALUATION"): PropStage {
  return { ...initialPropState(defaultPropRules, 0).stages[0], kind, days };
}
function render(stages: PropStage[], busy = false, timeZone = "UTC") {
  hooks.index = 0;
  return PropDailyLedger({ stages, currency: "USDT", timeZone, busy });
}
const html = (stages: PropStage[], busy = false, timeZone = "UTC") => renderToStaticMarkup(render(stages, busy, timeZone));
function button(nodes: Element[], label: string) {
  return nodes.find(node => node.props.onClick && textOf(node.props.children) === label)!;
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());

describe("daily ledger pagination and ordering", () => {
  it("shows empty feedback and keeps exactly ten rows on a single page", () => {
    expect(html([])).toContain(copy.propPractice.noDailyLedger);
    const markup = html([stage(Array.from({ length: 10 }, (_, i) => day(i + 1)))]);
    expect(markup.match(/<tr/g)).toHaveLength(11);
    expect(markup).not.toContain(copy.propPractice.dailyLedgerPagination);
    expect(markup).toContain(copy.propPractice.dailyLedgerSummary("10", "10"));
  });

  it("sorts globally by trading day, puts the later stage first on the same day, and preserves source data", () => {
    const stages = [stage([day(2), day(1), day(3, { settled: false, stageEnded: true })]), stage([day(4), day(3)], "FUNDED")];
    const before = structuredClone(stages);
    for (const item of stages) { Object.freeze(item.days); Object.freeze(item); }
    Object.freeze(stages);
    const markup = html(stages);
    expect(markup.indexOf("2026/1/4")).toBeLessThan(markup.indexOf("2026/1/3"));
    expect(markup.indexOf("2026/1/2")).toBeLessThan(markup.indexOf("2026/1/1"));
    expect(markup.indexOf("· 出金", markup.indexOf("2026/1/3"))).toBeLessThan(markup.indexOf("· 考核", markup.indexOf("2026/1/3")));
    expect(markup).toContain(copy.propPractice.stageEnded);
    expect(stages).toEqual(before);
  });

  it("keeps both entries when a same-day phase change crosses a page boundary", () => {
    const stages = [stage([day(1)]), stage(Array.from({ length: 10 }, (_, i) => day(i + 1)), "FUNDED")];
    let nodes = all(render(stages));
    let markup = html(stages);
    expect(markup.match(/<tr/g)).toHaveLength(11);
    expect(markup).toContain("· 出金"); expect(markup).not.toContain("· 考核");
    expect(button(nodes, copy.common.pagination.previous).props.disabled).toBe(true);
    expect(button(nodes, copy.common.pagination.next).props.disabled).toBe(false);
    (button(nodes, copy.common.pagination.next).props.onClick as () => void)();
    nodes = all(render(stages)); markup = html(stages);
    expect(markup.match(/<tr/g)).toHaveLength(2);
    expect(markup).toContain("· 考核"); expect(markup).not.toContain("· 出金");
    expect(markup).toContain(copy.common.pagination.page("2", "2"));
    expect(button(nodes, copy.common.pagination.next).props.disabled).toBe(true);
    (button(nodes, copy.common.pagination.previous).props.onClick as () => void)();
    expect(html(stages)).toContain(copy.common.pagination.page("1", "2"));
  });

  it("clamps the page after data shrinks and disables paging while loading", () => {
    const stages = [stage(Array.from({ length: 21 }, (_, i) => day(i + 1)))];
    let nodes = all(render(stages));
    (button(nodes, copy.common.pagination.next).props.onClick as () => void)();
    nodes = all(render(stages));
    (button(nodes, copy.common.pagination.next).props.onClick as () => void)();
    expect(html(stages)).toContain(copy.common.pagination.page("3", "3"));
    const shrunk = [stage(stages[0].days.slice(0, 11))];
    expect(html(shrunk)).toContain(copy.common.pagination.page("2", "2"));
    nodes = all(render(shrunk, true));
    expect(button(nodes, copy.common.pagination.previous).props.disabled).toBe(true);
    expect(button(nodes, copy.common.pagination.next).props.disabled).toBe(true);
    expect(html([])).toContain(copy.propPractice.noDailyLedger);
  });

  it("retains account time zone, unsettled status and recorded amounts", () => {
    const markup = html([stage([day(1, { day: "2026-01-01T00:30:00.000Z", settled: false, endRawNet: -25.5, balance: 49974.5 })])], false, "America/Los_Angeles");
    expect(markup).toContain("2025/12/31");
    expect(markup).toContain(copy.propPractice.pendingSettlement);
    expect(markup).toContain("-25.50 USDT"); expect(markup).toContain("49,974.50 USDT");
  });
});
