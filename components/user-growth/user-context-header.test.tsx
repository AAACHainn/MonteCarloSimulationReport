import React, { createElement } from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import { UserContextHeader } from "./user-context-header";
import { UserEntry } from "./user-entry";
import { GrowthSettlementToast } from "./growth-settlement-toast";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

describe("replay user context header layout", () => {
  it("keeps the breadcrumb and compact user entry on one row while placing feedback outside document flow", () => {
    const session = { id: "session-a", name: "Sample session" } as ReplaySessionSummary;
    const tree = UserContextHeader({ children: createElement("span", null, "breadcrumb"), session, growthNotice: "结算成功 +10", growthNoticeKey: 4 });
    const children = (tree.props as { children: Array<{ type: unknown; props: Record<string, unknown> }> }).children;
    expect(tree.props.className).toContain("justify-between");
    expect(children[0].type).toBe("div");
    expect(children[0].props.className).toContain("flex-1");
    expect(children[1].props.className).toContain("relative");
    const [entry, toast] = children[1].props.children as Array<{ type: unknown; key?: string | null; props: Record<string, unknown> }>;
    expect(entry.type).toBe(UserEntry);
    expect(entry.props.compact).toBe(true);
    expect(entry.props.session).toBe(session);
    expect(toast.type).toBe(GrowthSettlementToast);
    expect(toast.props.message).toBe("结算成功 +10");
    expect(toast.key).toBe("4");
    const renderedToast = GrowthSettlementToast({ message: "结算成功 +10" }) as { props: { className: string } };
    expect(renderedToast.props.className).toContain("absolute");
    expect(renderedToast.props.className).toContain("pointer-events-none");
    expect(children).toHaveLength(2);
  });
});
