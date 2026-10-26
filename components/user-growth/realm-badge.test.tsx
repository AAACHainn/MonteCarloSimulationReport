import React from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { RealmBadge } from "./realm-badge";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

describe("realm badge colors", () => {
  it.each([
    ["mortal", "bg-slate-100", "text-slate-700"],
    ["qi", "bg-emerald-50", "text-emerald-700"],
    ["foundation", "bg-blue-50", "text-blue-700"],
  ] as const)("uses the %s realm palette", (realm, background, foreground) => {
    const badge = RealmBadge({ realm, children: "境界" }) as { props: { className: string } };
    expect(badge.props.className).toContain(background);
    expect(badge.props.className).toContain(foreground);
  });
});
