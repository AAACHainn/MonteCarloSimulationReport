import { describe, expect, it } from "vitest";
import { calculateImportProgress } from "./import-progress";

const now = Date.parse("2026-09-12T00:01:00Z");

describe("calculateImportProgress", () => {
  it.each([
    ["UPLOADING", 50, 100, 5],
    ["ANALYZING", 50, 100, 22.5],
    ["IMPORTING", 50, 100, 67],
    ["FINALIZING", 0, 0, 99],
  ])("maps %s into its monotonic overall band", (stage, processed, total, expected) => {
    expect(calculateImportProgress({ status: "PROCESSING", stage, stageProcessedBytes: processed, stageTotalBytes: total, stageStartedAt: new Date(now - 10_000) }, now).progressPercent).toBe(expected);
  });

  it("returns 100% for completed jobs", () => {
    expect(calculateImportProgress({ status: "COMPLETED", stage: "COMPLETED", stageProcessedBytes: 0, stageTotalBytes: 0, stageStartedAt: null }, now)).toEqual({ progressPercent: 100, estimatedRemainingSeconds: 0, etaScope: null });
  });

  it("waits for a stable sample before estimating", () => {
    expect(calculateImportProgress({ status: "PROCESSING", stage: "ANALYZING", stageProcessedBytes: 1, stageTotalBytes: 1_000, stageStartedAt: new Date(now - 60_000) }, now).estimatedRemainingSeconds).toBeNull();
    expect(calculateImportProgress({ status: "PROCESSING", stage: "ANALYZING", stageProcessedBytes: 50, stageTotalBytes: 100, stageStartedAt: new Date(now - 4_000) }, now).estimatedRemainingSeconds).toBeNull();
  });

  it("reports stage ETA while analyzing and overall ETA while importing", () => {
    expect(calculateImportProgress({ status: "PROCESSING", stage: "ANALYZING", stageProcessedBytes: 50, stageTotalBytes: 100, stageStartedAt: new Date(now - 10_000) }, now)).toMatchObject({ estimatedRemainingSeconds: 10, etaScope: "STAGE" });
    expect(calculateImportProgress({ status: "PROCESSING", stage: "IMPORTING", stageProcessedBytes: 50, stageTotalBytes: 100, stageStartedAt: new Date(now - 10_000) }, now)).toMatchObject({ estimatedRemainingSeconds: 10, etaScope: "OVERALL" });
  });
});
