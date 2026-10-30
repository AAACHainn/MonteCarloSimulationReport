import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/i18n";
import { PropPayoutHistory, formatPayoutTradingDay } from "./prop-payout-history";

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[] }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [hooks.slots[index], (next: unknown) => {
        hooks.slots[index] = typeof next === "function"
          ? (next as (previous: unknown) => unknown)(hooks.slots[index])
          : next;
      }];
    },
    useMemo: (factory: () => unknown) => factory(),
  };
});

type Element = { type: unknown; props: Record<string, unknown> };
type Payout = { id: string; amount: number; share: number; received: number; evidence: string; createdAt: string };
function all(node: unknown): Element[] {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as Element;
  return [element, ...all(element.props?.children)];
}
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node && typeof node === "object" ? textOf((node as Element).props?.children) : "";
}
function payoutRows(count: number): Payout[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `payout-${index + 1}`, amount: 100 + index, share: 10, received: 90,
    evidence: JSON.stringify({ day: "2026-01-01T00:30:00.000Z" }),
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  }));
}
function render(payouts: Payout[], timeZone = "UTC", busy = false) {
  hooks.index = 0;
  return React.createElement(PropPayoutHistory, { payouts, currency: "USD", timeZone, busy });
}
function html(payouts: Payout[], timeZone = "UTC", busy = false) {
  return renderToStaticMarkup(render(payouts, timeZone, busy));
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());

describe("prop payout history", () => {
  it("shows an empty state for zero records and omits pagination through exactly ten", () => {
    expect(html([])).toContain(copy.propPractice.noPayouts);
    expect(html([])).not.toContain(copy.propPractice.payoutHistoryPagination);
    const ten = payoutRows(10);
    const markup = html(ten);
    expect(markup).toContain(copy.propPractice.payoutHistorySummary("10", "10"));
    expect(markup).not.toContain(copy.propPractice.payoutHistoryPagination);
    expect(markup.match(/<tr/g)).toHaveLength(11);
  });

  it("sorts newest created records first without mutating the source array", () => {
    const rows = payoutRows(10);
    const originalIds = rows.map(row => row.id);
    const markup = html(rows);
    expect(markup.indexOf("US$109.00")).toBeLessThan(markup.indexOf("US$108.00"));
    expect(markup.indexOf("US$108.00")).toBeLessThan(markup.indexOf("US$107.00"));
    expect(rows.map(row => row.id)).toEqual(originalIds);
  });

  it("paginates eleven rows and disables controls at both page boundaries", () => {
    const rows = payoutRows(11);
    const tree = () => { hooks.index = 0; return all(PropPayoutHistory({ payouts: rows, currency: "USD", timeZone: "UTC" })); };
    let nodes = tree();
    expect(nodes.some(node => node.type === "nav" && node.props["aria-label"] === copy.propPractice.payoutHistoryPagination)).toBe(true);
    expect(nodes.some(node => textOf(node.props.children) === copy.propPractice.payoutHistoryPage("1", "2"))).toBe(true);
    const previous = nodes.find(node => node.props.onClick && textOf(node.props.children) === copy.propPractice.payoutHistoryPrevious)!;
    const next = nodes.find(node => node.props.onClick && textOf(node.props.children) === copy.propPractice.payoutHistoryNext)!;
    expect(previous.props.disabled).toBe(true);
    expect(next.props.disabled).toBe(false);

    (next.props.onClick as () => void)();
    nodes = tree();
    expect(nodes.some(node => textOf(node.props.children) === copy.propPractice.payoutHistoryPage("2", "2"))).toBe(true);
    const lastPage = renderToStaticMarkup(render(rows));
    expect(lastPage).toContain("US$100.00");
    expect(lastPage).not.toContain("US$110.00");
    const previousOnLast = nodes.find(node => node.props.onClick && textOf(node.props.children) === copy.propPractice.payoutHistoryPrevious)!;
    const nextOnLast = nodes.find(node => node.props.onClick && textOf(node.props.children) === copy.propPractice.payoutHistoryNext)!;
    expect(previousOnLast.props.disabled).toBe(false);
    expect(nextOnLast.props.disabled).toBe(true);
  });

  it("formats the trading day in the supplied account time zone", () => {
    const evidence = JSON.stringify({ day: "2026-01-01T00:30:00.000Z" });
    expect(formatPayoutTradingDay(evidence, "America/Los_Angeles")).toBe("2025/12/31");
    expect(html(payoutRows(1), "America/Los_Angeles")).toContain("2025/12/31");
    expect(formatPayoutTradingDay("not-json", "UTC")).toBe(copy.common.dash);
  });
});
