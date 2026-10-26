import React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const rt = vi.hoisted(() => ({ pathname: "/users" }));
vi.mock("next/navigation", () => ({ usePathname: () => rt.pathname }));
vi.mock("@/components/user-growth/user-entry", () => ({ UserEntry: "user-entry" }));
import { AppHeader } from "./app-header";
type Element = { type: unknown; props: Record<string, unknown> };
function all(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(all);
  const element = node as Element;
  return element.props ? [element, ...all(element.props.children)] : [];
}
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
describe("shared header identity entry", () => {
  it("uses the session header as the only avatar entry on replay trade history", () => {
    rt.pathname = "/market-replay/market/trade-history";
    const elements = all(AppHeader());
    expect(elements.some(element => element.type === "nav")).toBe(true);
    expect(elements.some(element => element.type === "user-entry")).toBe(false);
  });
  it("retains global user selection on shared pages", () => {
    rt.pathname = "/users";
    expect(all(AppHeader()).some(element => element.type === "user-entry")).toBe(true);
    rt.pathname = "/market-replay/market";
    expect(AppHeader()).toBeNull();
  });
});
