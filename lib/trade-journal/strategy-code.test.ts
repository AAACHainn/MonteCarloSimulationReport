import { describe, expect, it } from "vitest";
import {
  evaluateStrategyCode,
  normalizeStrategyCode,
  parseStrategyCode,
  validateStrategyCode,
} from "./strategy-code";

describe("strategy code normalization and validation", () => {
  it.each([
    ["QS:A", "QS:A"],
    ["QS:A DN:S MA:A XH:B KJ:A", "QS:A DN:S MA:A XH:B KJ:A"],
    ["ABC:S X:B", "ABC:S X:B"],
    ["qs:a dn:s", "QS:A DN:S"],
    ["  qs:a   dn:s  xh:b ", "QS:A DN:S XH:B"],
  ])("accepts and normalizes %s", (input, normalized) => {
    expect(normalizeStrategyCode(input)).toBe(normalized);
    expect(validateStrategyCode(input)).toMatchObject({ valid: true, normalized });
  });

  it("parses arbitrary alphabetic project names", () => {
    expect(parseStrategyCode("TREND:A MOMENTUM:S SIGNAL:B")).toEqual([
      { key: "TREND", grade: "A" },
      { key: "MOMENTUM", grade: "S" },
      { key: "SIGNAL", grade: "B" },
    ]);
  });

  it.each([
    ["QS:D", "评级只能是S、A、B、C。"],
    ["QS-A", "应使用“项目:评级”的形式。"],
    ["QS:", "评级只能是S、A、B、C。"],
    [":A", "项目名称只能包含英文字母。"],
    ["Q1:A", "项目名称只能包含英文字母。"],
    ["QS:A QS:B", "发现重复项目QS。"],
    ["QS:A,DN:S", "项目之间应使用空格分隔。"],
    ["QS:A DN", "应使用“项目:评级”的形式。"],
  ])("rejects %s with a specific reason", (input, error) => {
    expect(validateStrategyCode(input)).toMatchObject({ valid: false, error });
  });

  it("allows an empty strategy code", () => {
    expect(validateStrategyCode("")).toEqual({
      valid: true,
      normalized: "",
      items: [],
      error: null,
    });
  });
});

describe("strategy code evaluation", () => {
  it.each([
    ["QS:A DN:S", "PASS", 0, 0],
    ["QS:A DN:S XH:B", "PASS", 1, 0],
    ["QS:A DN:A XH:B", "FAIL", 1, 0],
    ["QS:B", "FAIL", 1, 0],
    ["QS:A DN:B XH:B", "FAIL", 2, 0],
    ["QS:S DN:S ABC:C", "FAIL", 0, 1],
    ["QS:S DN:B ABC:C", "FAIL", 1, 1],
    ["", "UNRATED", 0, 0],
  ] as const)("evaluates %s as %s", (input, status, bCount, cCount) => {
    expect(evaluateStrategyCode(input)).toMatchObject({ status, bCount, cCount });
  });

  it("reports the projects graded C", () => {
    expect(evaluateStrategyCode("QS:C DN:A ABC:C").cKeys).toEqual(["QS", "ABC"]);
  });
});

