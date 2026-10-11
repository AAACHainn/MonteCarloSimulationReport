import { describe, expect, it } from "vitest";
import { displayIntervalOptions } from "./display-interval";

describe("shared display interval options", () => {
  it("only offers multiples of the source period, including custom periods", () => {
    const options = displayIntervalOptions(300, 600);
    expect(options).toContain(300);
    expect(options).toContain(600);
    expect(options).not.toContain(60);
    expect(options).not.toContain(540);
    expect(options.every((seconds) => seconds >= 300 && seconds % 300 === 0)).toBe(true);
  });
  it("keeps a nonstandard source period available after switching to a preset", () => {
    expect(displayIntervalOptions(90, 180)).toContain(90);
  });
  it("includes a compatible custom period once and sorts by duration", () => {
    const options = displayIntervalOptions(1, 540);
    expect(options.filter((seconds) => seconds === 540)).toHaveLength(1);
    expect(options).toEqual([...options].sort((left, right) => left - right));
  });
  it("requires known source metadata and rejects periods beyond one day", () => {
    expect(displayIntervalOptions(null, 60)).toEqual([]);
    expect(displayIntervalOptions(60, 86460)).not.toContain(86460);
  });
});
