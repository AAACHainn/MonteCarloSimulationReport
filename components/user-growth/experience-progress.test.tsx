import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { userIdentity } from "@/lib/user-growth/service";
import { growthProgress } from "@/lib/user-growth/presentation";
import { FOUNDATION_REQUIREMENTS, QI_THRESHOLDS } from "@/lib/user-growth/rules";
import { copy } from "@/lib/i18n";
import { ExperienceProgress } from "./experience-progress";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

function markup(totalXp: number, foundation = false) {
  return renderToStaticMarkup(React.createElement(ExperienceProgress, { growth: growthProgress(totalXp, foundation), compact: true }));
}

describe("avatar-menu experience progress presentation", () => {
  it("shows the mortal-to-qi threshold from the shared growth rules", () => {
    const html = markup(0);
    expect(html).toContain("0 / 100");
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain("width:0%");
    expect(html).toContain(copy.userGrowth.nextMortal);
  });

  it("shows the current middle qi layer and its actual next threshold", () => {
    const totalXp = 600;
    const start = QI_THRESHOLDS[1];
    const max = QI_THRESHOLDS[2] - start;
    const html = markup(totalXp);
    expect(html).toContain(`${totalXp - start} / ${max}`);
    expect(html).toContain(`aria-valuemax="${max}"`);
    expect(html).toContain(copy.userGrowth.qiLayer(copy.userGrowth.layerNames[2]));
  });

  it("keeps excess layer-twelve experience visible while capping the bar at 100%", () => {
    const twelveLayerThreshold = QI_THRESHOLDS[11];
    const nextRealmThreshold = FOUNDATION_REQUIREMENTS.totalXp;
    const totalXp = nextRealmThreshold + 1200;
    const html = markup(totalXp);
    expect(html).toContain("5,700 / 4,500");
    expect(html).toContain(`aria-valuenow="${nextRealmThreshold - twelveLayerThreshold}"`);
    expect(html).toContain("width:100%");
    expect(html).toContain(copy.userGrowth.foundationOne);
  });

  it("maps API user identity growth through the shared rules and gives foundation no fabricated next-layer bar", () => {
    const middle = userIdentity({ id: "middle", nickname: "中段", growth: { totalXp: 600, realm: "QI" } });
    expect(middle).toMatchObject({ realmLabel: copy.userGrowth.qiLayer(copy.userGrowth.layerNames[1]), growth: { totalXp: 600, realm: "qi", segment: { value: 200, max: 450 } } });

    const foundation = userIdentity({ id: "foundation", nickname: "筑基", growth: { totalXp: 21_100, realm: "FOUNDATION" } });
    expect(foundation.growth).toEqual({ totalXp: 21_100, realm: "foundation", segment: undefined });
    const html = renderToStaticMarkup(React.createElement(ExperienceProgress, { growth: foundation.growth!, compact: true }));
    expect(html).toContain(copy.userGrowth.foundationHint);
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("aria-valuemax");
  });
});
