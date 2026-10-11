import { describe, expect, it } from "vitest";
import { encodePdfText } from "./pdf-text";
describe("PDF text preservation", () => {
  it("preserves text after supplementary characters rather than truncating a line", () => {
    expect(encodePdfText("前😀后\n完整复盘", () => true)).toEqual({ text: "前[U+1F600]后\n完整复盘", escaped: true });
  });
  it("preserves unsupported BMP characters as reversible code points", () => {
    expect(encodePdfText("a\u0000b", (code) => code !== 0)).toEqual({ text: "a[U+0000]b", escaped: true });
  });
  it("keeps supported Chinese text and paragraph structure", () => {
    expect(encodePdfText("交易\r\n复盘\t完成", () => true)).toEqual({ text: "交易\n复盘    完成", escaped: false });
  });
});
