import { describe, expect, it } from "vitest";
import { fitFloatingPosition, parseFloatingPosition } from "./floating-position";

describe("floating launcher placement", () => {
  it("ignores corrupted browser storage instead of losing the launcher", () => {
    for (const value of [null, "", "{", "null", "[]", '{"x":"12","y":4}', '{"x":1e999,"y":0}']) expect(parseFloatingPosition(value)).toBeNull();
    expect(parseFloatingPosition('{"x":100,"y":200}')).toEqual({ x: 100, y: 200 });
  });
  it("keeps the entire launcher reachable after dragging or restoring desktop coordinates on a narrow viewport", () => {
    expect(fitFloatingPosition({ x: 1900, y: 1000 }, { width: 375, height: 812 })).toEqual({ x: 311, y: 748 });
    expect(fitFloatingPosition({ x: -500, y: -1 }, { width: 1440, height: 900 })).toEqual({ x: 16, y: 16 });
    expect(fitFloatingPosition({ x: 200, y: 300 }, { width: 1440, height: 900 })).toEqual({ x: 200, y: 300 });
    expect(fitFloatingPosition({ x: 100, y: 100 }, { width: 60, height: 48 })).toEqual({ x: 6, y: 0 });
  });
});
