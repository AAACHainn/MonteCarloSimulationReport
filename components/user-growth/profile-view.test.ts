import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copy } from "@/lib/i18n";
import { makePreviewProfile, previewUsers } from "@/lib/user-growth/preview-data";
import type { GrowthProfile } from "@/lib/user-growth/types";
import { ProfileView } from "./profile-view";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
function render(scenario: number, state: "normal" | "error" = "normal") {
  return renderProfile(makePreviewProfile(previewUsers[0], scenario), state);
}
function renderProfile(profile: GrowthProfile, state: "normal" | "error" = "normal") {
  return renderToStaticMarkup(createElement(ProfileView, {
    profile, selected: previewUsers[1], state,
    onRetry: vi.fn(), onSwitch: vi.fn(), onEdit: vi.fn(), onBreakthrough: async () => true,
    breaking: false, actionError: "", onOpenSession: vi.fn(), onSource: vi.fn(), onAllRecords: vi.fn(),
  }));
}
function realmTrack(html: string) {
  return html.match(/<ol\b(?=[^>]*aria-label="境界轨迹")[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? "";
}
function trackItems(html: string) { return [...realmTrack(html).matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map(match => match[0]); }
describe("growth profile presentation contract", () => {
  it("reuses identity and session views while hiding disconnected growth controls", () => {
    const profile = { ...makePreviewProfile(previewUsers[0], 0), growthPending: true, conditions: [] };
    const html = renderToStaticMarkup(createElement(ProfileView, {
      profile, state: "normal", onRetry: vi.fn(), onSwitch: vi.fn(), onEdit: vi.fn(), onBreakthrough: async () => false,
      breaking: false, actionError: "", onOpenSession: vi.fn(), onSource: vi.fn(), onAllRecords: vi.fn(),
    }));
    expect(html).toContain(copy.userGrowth.growthPending);
    expect(html).not.toContain("归属历史会话");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain(copy.userGrowth.showConditions);
    expect(html).not.toContain(copy.userGrowth.records + "</h3>");
  });
  it("keeps lifetime experience separate from the current segment", () => {
    const html = render(3);
    expect(html).toContain("16,500");
    expect(html).toContain('aria-valuenow="2900"');
    expect(html).toContain('aria-valuemax="4500"');
    expect(html).toContain("已满足 3 / 6");
    expect(html).toContain("当前选择：");
    expect(html).toContain(previewUsers[1].nickname);
  });
  it("provides separate profile entries for reward details and realm thresholds", () => {
    const html = render(3);
    expect(html.split(copy.userGrowth.guide.title)).toHaveLength(2);
    expect(html).not.toContain(copy.userGrowth.guide.viewThresholds);
  });
  it("places a 100 XP qi-one profile on the second true realm milestone", () => {
    const base = makePreviewProfile(previewUsers[0], 0);
    const profile: GrowthProfile = { ...base, totalXp: 100, realm: "qi", layer: 1, user: { ...base.user, realmLabel: copy.userGrowth.qiLayer(copy.userGrowth.layerNames[0]) } };
    const html = renderProfile(profile);
    const items = trackItems(html);
    expect(items).toHaveLength(14);
    expect(items.filter(item => item.includes('aria-current="step"'))).toHaveLength(1);
    expect(items.findIndex(item => item.includes('aria-current="step"'))).toBe(1);
    expect(items[1]).toContain(copy.userGrowth.qiLayer(copy.userGrowth.layerNames[0]));
    expect(items[1]).toContain(">1</span>");
    expect(items[0]).toContain("milestoneReached");
    expect(items[1]).toContain("milestoneCurrent");
    expect(html).toContain(`style="width:${1 / 13 * 100}%"`);
  });
  it.each([
    [0, 0, "mortal"], [2, 6, "qi"], [3, 12, "qi"], [6, 13, "foundation"],
  ] as const)("marks exactly one current node for scenario %i", (scenario, index, realm) => {
    const items = trackItems(render(scenario));
    expect(items).toHaveLength(14);
    const current = items.flatMap((item, itemIndex) => item.includes('aria-current="step"') ? [itemIndex] : []);
    expect(current).toEqual([index]);
    expect(items[index]).toContain("milestoneCurrent");
    if (realm === "foundation") expect(items[13]).toContain(copy.userGrowth.foundationOne);
  });
  it("does not highlight any milestone while growth is pending", () => {
    const profile = { ...makePreviewProfile(previewUsers[0], 3), growthPending: true };
    const html = renderProfile(profile);
    expect(trackItems(html).filter(item => item.includes('aria-current="step"'))).toHaveLength(0);
    expect(html).toContain("width:0%");
  });
  it("groups the nickname and realm badge in one row", () => {
    const profile = makePreviewProfile(previewUsers[0], 3);
    const html = renderProfile(profile);
    const name = html.indexOf(`<h1 class="max-w-full break-words text-3xl font-semibold tracking-tight text-slate-950">${profile.user.nickname}</h1>`);
    const realm = html.indexOf(`<h2`);
    const row = html.lastIndexOf('<div class="flex flex-wrap items-center gap-3">', name);
    expect(row).toBeGreaterThan(-1);
    expect(name).toBeGreaterThan(row);
    expect(realm).toBeGreaterThan(name);
    expect(html.slice(row, realm)).toContain(profile.user.nickname);
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
    const records = html.match(new RegExp(`<ol aria-label="${copy.userGrowth.recordsList}"[^>]*>([\\s\\S]*?)<\\/ol>`))?.[1] ?? "";
    expect(html).toContain("共 5,000 条记录");
    expect(records.match(/<li /g)).toHaveLength(5);
    expect(html).toContain(copy.userGrowth.allRecords);
    expect(html).not.toContain("分币种实得");
  });
});
