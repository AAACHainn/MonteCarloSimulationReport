import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/i18n";
import { makePreviewProfile, previewUsers } from "@/lib/user-growth/preview-data";
import { ProfileView } from "./profile-view";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
function render(scenario: number, state: "normal" | "error" = "normal") {
  return renderToStaticMarkup(createElement(ProfileView, {
    profile: makePreviewProfile(previewUsers[0], scenario), selected: previewUsers[1], state,
    onRetry: vi.fn(), onSwitch: vi.fn(), onEdit: vi.fn(), onBreakthrough: async () => true,
    breaking: false, actionError: "", onAssign: vi.fn(), onOpenSession: vi.fn(), onSource: vi.fn(), onAllRecords: vi.fn(),
  }));
}
describe("growth profile presentation contract", () => {
  it("keeps lifetime experience separate from the current segment", () => {
    const html = render(3);
    expect(html).toContain("16,500");
    expect(html).toContain('aria-valuenow="2900"');
    expect(html).toContain('aria-valuemax="4500"');
    expect(html).toContain("已满足 3 / 6");
    expect(html).toContain("当前选择：");
    expect(html).toContain(previewUsers[1].nickname);
  });
  it("shows a mortal without a layer, fabricated records or a breakthrough action", () => {
    const html = render(0);
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain(copy.userGrowth.recordEmpty);
    expect(html).not.toContain(copy.userGrowth.breakthrough + "</button>");
    expect(html).toContain(copy.userGrowth.showConditions);
  });
  it("caps the graphic while preserving experience beyond the target", () => {
    const html = render(4);
    expect(html).toContain('aria-valuenow="4500"');
    expect(html).toContain('aria-valuetext="5,700 / 4,500 经验"');
    expect(html).toContain("19,300");
    expect(html).not.toContain(copy.userGrowth.ready);
  });
  it("retains known values on a failed query and disables breakthrough", () => {
    const html = render(5, "error");
    expect(html).toContain(copy.userGrowth.stale);
    expect(html).toContain("19,300");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>突破筑基<\/button>/);
  });
  it("shows foundation without inventing the next experience target", () => {
    const html = render(6);
    expect(html).toContain(copy.userGrowth.foundationOne);
    expect(html).toContain(copy.userGrowth.foundationHint);
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain(copy.userGrowth.showConditions);
  });
  it("keeps deleted sources and zero-experience payouts visible", () => {
    const html = render(3);
    expect(html).toContain(copy.userGrowth.deleted);
    expect(html).toContain(copy.userGrowth.noXp);
    expect(html).toContain("实得 900 USDT");
  });
  it("shows existing evidence for a mortal who has already earned experience", () => {
    expect(render(1)).not.toContain(copy.userGrowth.recordEmpty);
  });
  it("does not overwrite an edited nickname with the long-name fixture", () => {
    const edited = { ...previewUsers[0], nickname: "已修改昵称" };
    expect(makePreviewProfile(edited, 7).user.nickname).toBe(edited.nickname);
  });
  it("keeps the recent list bounded even when the archive has thousands of records", () => {
    const html = render(8);
    expect(html).toContain("共 5,000 条记录");
    expect(html.match(/<li /g)).toHaveLength(5);
    expect(html).toContain(copy.userGrowth.allRecords);
    expect(html).not.toContain("分币种实得");
  });
});
