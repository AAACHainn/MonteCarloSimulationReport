import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/i18n";
import { defaultPropRules, initialPropState, payoutPreview } from "@/lib/prop-practice/rules";
import type { PropRuntime } from "@/lib/prop-practice/service";
import { PropAccountPanel } from "./prop-account-panel";

const rt = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => void> }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void) => { rt.effects.push(effect); },
    useRef: (initial: unknown) => {
      const index = rt.index++;
      if (!(index in rt.slots)) rt.slots[index] = { current: initial };
      return rt.slots[index];
    },
    useState: (initial: unknown) => {
      const index = rt.index++;
      if (!(index in rt.slots)) rt.slots[index] = initial;
      return [rt.slots[index], (next: unknown) => {
        rt.slots[index] = typeof next === "function"
          ? (next as (previous: unknown) => unknown)(rt.slots[index])
          : next;
      }];
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("./replay-session-context", () => ({ useReplaySession: () => null }));
vi.mock("./paper-trading-panel", () => ({ PaperAccountMetrics: "paper-metrics" }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: "dialog" }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: "confirm-dialog" }));
vi.mock("@/lib/uuid", () => ({ createUuid: () => "test-request-id" }));
vi.mock("./prop-payout-form", () => ({ PropPayoutForm: "payout-form", PropPayoutReceipt: "payout-receipt" }));
vi.mock("./prop-payout-history", () => ({ PropPayoutHistory: "payout-history" }));

type Element = { type: unknown; props: Record<string, unknown> };
type Payout = { id: string; amount: number; share: number; received: number; evidence: string; createdAt: string };
type Account = PropRuntime & { preview: ReturnType<typeof payoutPreview>; payouts: Payout[]; events: Array<{ id: string; type: string }> };
function all(node: unknown): Element[] {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as Element;
  return [element, ...all(element.props?.children), ...all(element.props?.headerActions), ...all(element.props?.historyAction)];
}
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node && typeof node === "object" ? textOf((node as Element).props?.children) : "";
}
function payout(id: string, amount = 500): Payout {
  return { id, amount, share: 50, received: amount - 50, evidence: JSON.stringify({ day: "2026-10-30T00:00:00.000Z" }), createdAt: "2026-10-30T12:00:00.000Z" };
}
function runtime(): PropRuntime {
  const rules = structuredClone(defaultPropRules);
  rules.name = "Payout test account";
  const state = initialPropState(rules, 0);
  state.phase = "FUNDED";
  state.stages[0].kind = "FUNDED";
  state.last = { sequence: 10, day: "2026-10-30", rawNet: 5200, unrealized: 0, flat: true, pending: 0, hadFill: true };
  state.stages[0].days = [{
    day: "2026-10-30", startRawNet: 5000, endRawNet: 5200, balance: 55200, traded: true, settled: true,
  }];
  return {
    state, roundNumber: 2,
    snapshot: {
      rules, currency: "USD",
      calendar: { session: { timezone: "America/Los_Angeles" } },
    } as PropRuntime["snapshot"],
  };
}
function account(base: PropRuntime, payouts: Payout[]): Account {
  return { ...base, preview: payoutPreview(base.snapshot.rules, base.state), payouts, events: [{ id: "event-1", type: "PAYOUT" }] };
}
function response(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}
let base: PropRuntime;
let fetchMock: ReturnType<typeof vi.fn>;
let getCount: number;
let postCount: number;
let changed: ReturnType<typeof vi.fn>;
let beforeOpen: ReturnType<typeof vi.fn>;
let refreshedPayouts: Payout[];
function setup(initialPayouts: Payout[] = [], refreshed: Payout[] = [payout("payout-new")]) {
  base = runtime();
  refreshedPayouts = refreshed;
  getCount = 0;
  postCount = 0;
  changed = vi.fn(async () => undefined);
  beforeOpen = vi.fn(async () => undefined);
  fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      postCount++;
      return response({ payout: { amount: 500, received: 450 } });
    }
    getCount++;
    const payouts = getCount === 1 ? initialPayouts : refreshedPayouts;
    return response({ account: account(base, payouts), version: 7, status: "ACTIVE", projectionId: "projection-1" });
  });
  vi.stubGlobal("fetch", fetchMock);
}
function render() {
  rt.index = 0;
  rt.effects = [];
  const nodes = all(PropAccountPanel({
    sessionId: "session-1", runtime: base, onBeforeOpen: beforeOpen, onChanged: changed, overview: true,
  }));
  for (const effect of rt.effects) effect();
  return nodes;
}
function findButton(nodes: Element[], label: string) {
  return nodes.find(node => node.type === "button" && textOf(node.props.children) === label)!;
}
async function settleAsync() {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}
function openButton(nodes: Element[], label: string) {
  const button = findButton(nodes, label);
  (button.props.onClick as () => void)();
}

beforeEach(() => {
  rt.index = 0; rt.slots = [];
  vi.stubGlobal("React", React);
  setup();
});
afterEach(() => vi.unstubAllGlobals());

describe("prop account payout navigation", () => {
  it("switches between application and history without extra requests, preserves the draft, and keeps one dialog", async () => {
    let nodes = render();
    openButton(nodes, copy.propPractice.payout);
    await settleAsync();
    nodes = render();
    expect(getCount).toBe(1);
    expect(postCount).toBe(0);
    const dialogs = nodes.filter(node => node.type === "dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].props.open).toBe(true);
    expect(nodes.some(node => node.type === "table")).toBe(false);
    let form = nodes.find(node => node.type === "payout-form")!;
    expect(form.props.amount).toBe(String(account(base, []).preview.maximum));
    (form.props.onAmountChange as (value: string) => void)("777.25");

    const historyToggle = findButton(nodes, copy.propPractice.payoutHistoryEntry("0"));
    (historyToggle.props.onClick as () => void)();
    nodes = render();
    expect(nodes.some(node => node.type === "payout-history" && node.props.timeZone === "America/Los_Angeles")).toBe(true);
    expect(findButton(nodes, copy.propPractice.payoutReturnApplication)).toBeDefined();
    expect(nodes.filter(node => node.type === "dialog")).toHaveLength(1);
    expect(getCount).toBe(1);
    expect(postCount).toBe(0);

    (findButton(nodes, copy.propPractice.payoutReturnApplication).props.onClick as () => void)();
    nodes = render();
    form = nodes.find(node => node.type === "payout-form")!;
    expect(form.props.amount).toBe("777.25");
    expect(nodes.some(node => node.type === "table")).toBe(false);
    expect(nodes.filter(node => node.type === "dialog")).toHaveLength(1);
    expect(getCount).toBe(1);
    expect(postCount).toBe(0);
  });

  it("shows refreshed payout history and count after a successful request", async () => {
    setup([], [payout("payout-new", 700)]);
    let nodes = render();
    openButton(nodes, copy.propPractice.payout);
    await settleAsync();
    nodes = render();
    const form = nodes.find(node => node.type === "payout-form")!;
    (form.props.onSubmit as () => void)();
    nodes = render();
    expect(nodes.filter(node => node.type === "dialog" && node.props.open === true)).toHaveLength(0);
    const confirmation = nodes.find(node => node.type === "confirm-dialog")!;
    expect(confirmation.props.open).toBe(true);
    (confirmation.props.onConfirm as () => void)();
    await settleAsync();
    nodes = render();
    expect(postCount).toBe(1);
    expect(getCount).toBe(2);
    expect(changed).toHaveBeenCalledOnce();
    expect(nodes.some(node => node.type === "dialog" && node.props.open === true)).toBe(true);
    expect(nodes.some(node => node.props.role === "status" && textOf(node).includes(copy.propPractice.payoutSuccess))).toBe(true);

    const navigationButton = findButton(nodes, copy.propPractice.payoutHistoryEntry("1"));
    const focus = vi.fn();
    const navigationRef = navigationButton.props.ref as { current: unknown };
    navigationRef.current = { focus };
    const successHistory = nodes.find(node => node.type === "button" && textOf(node.props.children).startsWith(copy.propPractice.viewPayoutHistory))!;
    (successHistory.props.onClick as () => void)();
    nodes = render();
    expect(focus).toHaveBeenCalledOnce();
    const history = nodes.find(node => node.type === "payout-history")!;
    expect((history.props.payouts as Payout[]).map(item => item.id)).toEqual(["payout-new"]);
    (findButton(nodes, copy.propPractice.payoutReturnApplication).props.onClick as () => void)();
    nodes = render();
    expect(findButton(nodes, copy.propPractice.payoutHistoryEntry("1"))).toBeDefined();
    expect(postCount).toBe(1);
    expect(getCount).toBe(2);
    expect(nodes.filter(node => node.type === "dialog")).toHaveLength(1);
  });

  it("keeps the existing rules, daily ledger, and events views available", async () => {
    let nodes = render();
    for (const [label, title] of [
      [copy.propPractice.rules, copy.propPractice.rules],
      [copy.propPractice.dailyLedger, copy.propPractice.dailyLedger],
      [copy.propPractice.events, copy.propPractice.events],
    ]) {
      openButton(nodes, label);
      await settleAsync();
      nodes = render();
      expect(nodes.find(node => node.type === "dialog")?.props.title).toBe(title);
    }
    expect(getCount).toBe(3);
    expect(postCount).toBe(0);
  });
});
