import { describe, expect, it } from "vitest";
import {
  compileStrategyCodeRegex,
  MAX_STRATEGY_CODE_REGEX_LENGTH,
  STRATEGY_CODE_FAIL_REGEX,
  STRATEGY_CODE_PASS_REGEX,
} from "./strategy-code-filter";

const values = [
  "QS:A DN:S XH:B",
  "QS:A DN:B XH:B",
  "QS:S DN:S ABC:C",
  null,
];

function filter(expression: string) {
  const compiled = compileStrategyCodeRegex(expression);
  return {
    error: compiled.error,
    values: values.filter((value) => compiled.test(value)),
  };
}

describe("strategy code regex filter", () => {
  it("matches XH:B case-insensitively", () => {
    expect(filter("\\bxh:b\\b")).toEqual({
      error: null,
      values: ["QS:A DN:S XH:B", "QS:A DN:B XH:B"],
    });
  });

  it("supports multiple lookahead conditions", () => {
    expect(filter("^(?=.*\\bQS:A\\b)(?=.*\\bXH:B\\b).+$").values).toEqual([
      "QS:A DN:S XH:B",
      "QS:A DN:B XH:B",
    ]);
  });

  it("returns an error without filtering for invalid regex", () => {
    expect(filter("[")).toEqual({ error: "INVALID_REGEX", values });
  });

  it("restores all records when the filter is cleared", () => {
    expect(filter("").values).toEqual(values);
  });

  it("rejects overlong regex without filtering", () => {
    expect(filter("A".repeat(MAX_STRATEGY_CODE_REGEX_LENGTH + 1))).toEqual({
      error: "TOO_LONG",
      values,
    });
  });
});

describe("strategy code quick filters", () => {
  it.each([
    ["QS:A DN:S", "PASS"],
    ["QS:A DN:S XH:B", "PASS"],
    ["QS:A DN:A XH:B", "FAIL"],
    ["QS:B", "FAIL"],
    ["QS:A DN:B XH:B", "FAIL"],
    ["QS:S DN:S ABC:C", "FAIL"],
    ["QS:S DN:B ABC:C", "FAIL"],
    [null, "UNRATED"],
  ] as const)("classifies %s as %s", (strategyCode, expectedStatus) => {
    const passFilter = compileStrategyCodeRegex(STRATEGY_CODE_PASS_REGEX);
    const failFilter = compileStrategyCodeRegex(STRATEGY_CODE_FAIL_REGEX);

    expect(passFilter.error).toBeNull();
    expect(failFilter.error).toBeNull();
    expect(passFilter.test(strategyCode)).toBe(expectedStatus === "PASS");
    expect(failFilter.test(strategyCode)).toBe(expectedStatus === "FAIL");
  });
});
