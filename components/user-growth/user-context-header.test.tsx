import React, { createElement } from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReplaySessionSummary } from "@/lib/replay-sessions/types";
import { UserContextHeader } from "./user-context-header";
import { UserEntry } from "./user-entry";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

describe("replay user context header layout", () => {
  it("keeps breadcrumb content and compact user entry as siblings on the same row", () => {
    const session = { id: "session-a", name: "Sample session" } as ReplaySessionSummary;
    const tree = UserContextHeader({ children: createElement("span", null, "breadcrumb"), session });
    const children = (tree.props as { children: Array<{ type: unknown; props: Record<string, unknown> }> }).children;
    expect(tree.props.className).toContain("justify-between");
    expect(children[0].type).toBe("div");
    expect(children[0].props.className).toContain("flex-1");
    expect(children[1].type).toBe(UserEntry);
    expect(children[1].props.compact).toBe(true);
    expect(children[1].props.session).toBe(session);
    expect(children).toHaveLength(2);
  });
});
