import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { APPEARANCE_BOOTSTRAP, APPEARANCE_STORAGE_KEY, parseAppearance, readAppearance, saveAppearance } from "./appearance";

function boot(storage: object) {
  const root = { classList: { toggle: vi.fn() }, style: { colorScheme: "" } };
  runInNewContext(APPEARANCE_BOOTSTRAP, { window: storage, document: { documentElement: root } });
  return root;
}
describe("browser appearance initialization", () => {
  it.each([null, "", "system", "DARK", "{\"mode\":\"dark\"}", "light", "dark"])("agrees on the first paint and provider fallback for %s", value => {
    const getItem = vi.fn(() => value);
    const expected = parseAppearance(value);
    const root = boot({ localStorage: { getItem } });
    expect(root.style.colorScheme).toBe(expected);
    expect(root.classList.toggle).toHaveBeenCalledWith("dark", expected === "dark");
    expect(readAppearance({ getItem })).toBe(expected);
    expect(getItem).toHaveBeenCalledWith(APPEARANCE_STORAGE_KEY);
  });
  it("survives both blocked access and blocked storage methods", () => {
    const root = boot(Object.defineProperty({}, "localStorage", { get() { throw new Error("blocked"); } }));
    expect(root.style.colorScheme).toBe("light");
    expect(readAppearance({ getItem() { throw new Error("blocked"); } })).toBe("light");
    expect(() => saveAppearance({ setItem() { throw new Error("full"); } }, "dark")).not.toThrow();
  });
});
