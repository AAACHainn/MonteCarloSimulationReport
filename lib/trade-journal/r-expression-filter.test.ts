import { describe, expect, it } from "vitest";
import { compileRExpressionFilter } from "./r-expression-filter";

function matches(expression: string, values: number[]) {
  const filter = compileRExpressionFilter(expression);
  expect(filter.error).toBeNull();
  return values.filter((value) => filter.test(value));
}

describe("compileRExpressionFilter", () => {
  it("matches a closed interval", () => {
    expect(matches("[1,3]", [0.99, 1, 2, 3, 3.01])).toEqual([1, 2, 3]);
  });

  it("matches an open interval", () => {
    expect(matches("(1,3)", [1, 2, 3])).toEqual([2]);
  });

  it("matches a left-closed right-open interval", () => {
    expect(matches("[1,3)", [1, 2, 3])).toEqual([1, 2]);
  });

  it("matches non-zero values with not-equal syntax", () => {
    expect(matches("p!=0", [-1, 0, 2])).toEqual([-1, 2]);
  });

  it("matches non-zero values with comparison syntax", () => {
    expect(matches("p<0||p>0", [-1, 0, 2])).toEqual([-1, 2]);
  });

  it("matches boolean bounds like a closed interval", () => {
    expect(matches("p>=1&&p<=3", [0.99, 1, 2, 3, 3.01])).toEqual([1, 2, 3]);
  });

  it("supports parentheses and comparison precedence", () => {
    expect(matches("(p>=1&&p<=3)||p==-1", [-1, 0, 1, 4])).toEqual([-1, 1]);
  });

  it("returns an error and does not filter for invalid expressions", () => {
    const filter = compileRExpressionFilter("p>=");
    expect(filter.error).toBe("INVALID_EXPRESSION");
    expect([-1, 0, 1].filter((value) => filter.test(value))).toEqual([-1, 0, 1]);
  });
});
