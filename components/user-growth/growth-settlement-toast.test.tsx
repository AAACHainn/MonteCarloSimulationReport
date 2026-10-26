import { readFileSync } from "node:fs";
import React from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { GrowthSettlementToast } from "./growth-settlement-toast";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

describe("growth settlement toast presentation", () => {
  it("renders no layout element without a message and positions feedback outside normal flow", () => {
    expect(GrowthSettlementToast({ message: null })).toBeNull();
    const toast = GrowthSettlementToast({ message: "境界提升 +10" }) as { props: { role: string; className: string; children: string } };
    expect(toast.props.role).toBe("status");
    expect(toast.props.className).toContain("absolute");
    expect(toast.props.className).toContain("pointer-events-none");
    expect(toast.props.children).toBe("境界提升 +10");
  });

  it("fades within five seconds and removes animation for reduced-motion users", () => {
    const css = readFileSync(new URL("./user-growth.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.settlementToast\s*\{\s*animation:\s*settlement-notice 5s/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.settlementToast\s*\{\s*animation:\s*none/);
  });
});
