import { describe, expect, it } from "vitest";
import {
  addCmeDailyVolume,
  buildCmeVolumeLeadMap,
  cmeVolumeDateKey,
  normalizeCmeOutrightSymbol,
  type CmeDailyVolumes,
} from "./cme-contracts";

describe("CME parent-symbol contracts", () => {
  it("accepts all futures month codes for the exact root and rejects spreads", () => {
    expect(normalizeCmeOutrightSymbol("MGCG2", "mgc")).toBe("MGCG2");
    expect(normalizeCmeOutrightSymbol("MGCJ22", "MGC")).toBe("MGCJ22");
    expect(normalizeCmeOutrightSymbol("MGCM2", "MGC")).toBe("MGCM2");
    expect(normalizeCmeOutrightSymbol("MGCQ2", "MGC")).toBe("MGCQ2");
    expect(normalizeCmeOutrightSymbol("MGCV2", "MGC")).toBe("MGCV2");
    expect(normalizeCmeOutrightSymbol("MGCZ2", "MGC")).toBe("MGCZ2");
    expect(normalizeCmeOutrightSymbol("MGCV2-MGCZ2", "MGC")).toBeNull();
    expect(normalizeCmeOutrightSymbol("GCZ2", "MGC")).toBeNull();
  });

  it("uses the previous available UTC day's volume leader", () => {
    const volumes: CmeDailyVolumes = new Map();
    addCmeDailyVolume(volumes, new Date("2024-09-01T22:00:00Z"), "MGCV4", 100);
    addCmeDailyVolume(volumes, new Date("2024-09-01T22:00:00Z"), "MGCZ4", 20);
    addCmeDailyVolume(volumes, new Date("2024-09-02T00:00:00Z"), "MGCV4", 30);
    addCmeDailyVolume(volumes, new Date("2024-09-02T00:00:00Z"), "MGCZ4", 200);
    addCmeDailyVolume(volumes, new Date("2024-09-03T00:00:00Z"), "MGCV4", 10);
    addCmeDailyVolume(volumes, new Date("2024-09-03T00:00:00Z"), "MGCZ4", 250);

    expect(buildCmeVolumeLeadMap(volumes)).toEqual(new Map([
      ["2024-09-01", "MGCV4"],
      ["2024-09-02", "MGCV4"],
      ["2024-09-03", "MGCZ4"],
    ]));
  });

  it("uses UTC calendar dates for Databento daily volume rankings", () => {
    expect(cmeVolumeDateKey(new Date("2024-09-01T23:59:59Z"))).toBe("2024-09-01");
    expect(cmeVolumeDateKey(new Date("2024-09-02T00:00:00Z"))).toBe("2024-09-02");
  });
});
