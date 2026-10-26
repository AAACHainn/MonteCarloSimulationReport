import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ id: 0, focused: 0, createElement: undefined as unknown }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => {
    const next = { ...(props ?? {}) } as Record<string, unknown>;
    if (children.length) next.children = children.length === 1 ? children[0] : children;
    if (type === "button" && typeof next.ref === "function") (next.ref as (value: { focus: () => void }) => void)({ focus: () => { runtime.focused++; } });
    return { type, props: next };
  };
  runtime.createElement = createElement;
  return { ...actual, default: { createElement }, createElement, useId: () => `growth-rules-${++runtime.id}`, useRef: <T,>(current: T) => ({ current }) };
});
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/badge", () => ({ Badge: "badge" }));
vi.mock("@/components/ui/table", () => ({ Table: "table", TableBody: "tbody", TableCell: "td", TableHead: "th", TableHeader: "thead", TableRow: "tr" }));

import React from "react";
import { copy } from "@/lib/i18n";
import { FOUNDATION_REQUIREMENTS, GROWTH_XP, QI_THRESHOLDS } from "@/lib/user-growth/rules";
import { GrowthRulesBody, type GrowthRulesTab } from "./growth-rules-dialog";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

type Node = { type: unknown; props: Record<string, unknown> } | string | number | null | undefined | Array<Node>;
function all(node: Node): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as { type: unknown; props?: Record<string, unknown> };
  if (!element.props) return [];
  return [{ type: element.type, props: element.props }, ...all(element.props.children as Node)];
}
function text(node: Node): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text((node as { props?: Record<string, unknown> }).props?.children as Node);
}
function render(tab: GrowthRulesTab = "experience", current?: { realm: "mortal" | "qi" | "foundation"; layer: number }, onTabChange = vi.fn()) {
  runtime.id = 0;
  return { tree: GrowthRulesBody({ tab, current, onTabChange }), onTabChange };
}

describe("growth rules dialog", () => {
  it("opens on the experience tab and lists the four existing reward constants", () => {
    const { tree } = render();
    const tabs = all(tree).filter(element => element.props.role === "tab");
    expect(tabs.map(tab => tab.props["aria-selected"])).toEqual([true, false]);
    const rewardRows = all(tree).filter(element => element.type === "tr" && all(element as Node).some(child => child.type === "td"));
    expect(rewardRows).toHaveLength(4);
    expect(rewardRows.map(row => text(row as Node))).toEqual(expect.arrayContaining([
      expect.stringContaining(`+${GROWTH_XP.CYCLE}`), expect.stringContaining(`+${GROWTH_XP.REVIEW}`),
      expect.stringContaining(`+${GROWTH_XP.EVALUATION}`), expect.stringContaining(`+${GROWTH_XP.PAYOUT_FIRST}`),
    ]));
    expect([GROWTH_XP.CYCLE, GROWTH_XP.REVIEW, GROWTH_XP.EVALUATION, GROWTH_XP.PAYOUT_FIRST]).toEqual([5, 10, 100, 200]);
    expect(text(tree as Node)).toContain(copy.userGrowth.guide.notesTitle);
  });

  it("changes tabs by button and arrow/Home/End keys", () => {
    const { tree, onTabChange } = render();
    const tabs = all(tree).filter(element => element.props.role === "tab");
    (tabs[0].props.onClick as () => void)();
    expect(onTabChange).toHaveBeenCalledWith("experience");
    const preventDefault = vi.fn();
    (tabs[0].props.onKeyDown as (event: { key: string; preventDefault: () => void }) => void)({ key: "ArrowRight", preventDefault });
    expect(onTabChange).toHaveBeenLastCalledWith("realms");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(runtime.focused).toBe(1);
    (tabs[1].props.onKeyDown as (event: { key: string; preventDefault: () => void }) => void)({ key: "Home", preventDefault });
    expect(onTabChange).toHaveBeenLastCalledWith("experience");
    (tabs[0].props.onKeyDown as (event: { key: string; preventDefault: () => void }) => void)({ key: "End", preventDefault });
    expect(onTabChange).toHaveBeenLastCalledWith("realms");
  });

  it("shows fourteen cumulative thresholds, including the 4,500 XP foundation increment", () => {
    const { tree } = render("realms");
    const rows = all(tree).filter(element => element.type === "tr" && all(element as Node).some(child => child.type === "td"));
    expect(rows).toHaveLength(14);
    const foundation = rows.at(-1)!;
    expect(text(foundation as Node)).toContain("18,100");
    expect(text(foundation as Node)).toContain("4,500");
    expect(FOUNDATION_REQUIREMENTS.totalXp).toBe(18_100);
    expect(QI_THRESHOLDS.at(-1)).toBe(13_600);
    expect(FOUNDATION_REQUIREMENTS.totalXp - QI_THRESHOLDS.at(-1)!).toBe(4_500);
  });

  it.each([
    [{ realm: "mortal", layer: 0 }, "凡人"],
    [{ realm: "qi", layer: 5 }, "炼气五层"],
    [{ realm: "foundation", layer: 1 }, "筑基一层"],
  ] as const)("highlights only the current %s realm", (current, label) => {
    const { tree } = render("realms", current);
    const active = all(tree).filter(element => element.type === "tr" && element.props["aria-current"] === "step");
    expect(active).toHaveLength(1);
    expect(text(active[0] as Node)).toContain(label);
  });

  it("leaves unknown and over-cap qi states without a foundation highlight", () => {
    const unknown = render("realms");
    expect(all(unknown.tree).some(element => element.props["aria-current"] === "step")).toBe(false);
    const excessQi = render("realms", { realm: "qi", layer: 12 });
    const active = all(excessQi.tree).filter(element => element.type === "tr" && element.props["aria-current"] === "step");
    expect(active).toHaveLength(1);
    expect(text(active[0] as Node)).toContain("炼气十二层");
    expect(text(active[0] as Node)).not.toContain(copy.userGrowth.foundationOne);
  });
});
