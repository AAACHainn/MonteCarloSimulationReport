/** jsPDF's Identity-H encoder is UTF-16/BMP and stops at an unmapped glyph. */
export function encodePdfText(value: string, supports: (code: number) => boolean) {
  let escaped = false;
  const text = Array.from(value.replace(/\r\n?/g, "\n")).map((character) => {
    if (character === "\n") return character;
    if (character === "\t") return "    ";
    const code = character.codePointAt(0)!;
    if (code <= 0xffff && supports(code)) return character;
    escaped = true;
    return `[U+${code.toString(16).toUpperCase().padStart(4, "0")}]`;
  }).join("");
  return { text, escaped };
}
