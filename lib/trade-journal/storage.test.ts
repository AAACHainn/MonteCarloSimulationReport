import { describe, expect, it } from "vitest";
import { validateScreenshotBuffer } from "./storage";

describe("validateScreenshotBuffer", () => {
  it("accepts a PNG signature", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateScreenshotBuffer(png, "trade.png")).toBe(".png");
  });

  it("rejects content that does not match the file extension", () => {
    expect(() => validateScreenshotBuffer(Buffer.from("not an image"), "trade.png"))
      .toThrow("截图内容与文件格式不匹配。");
  });
});
