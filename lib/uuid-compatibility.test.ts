import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
async function restrictedMessages(code: string, filePath = "components/ai/http-uuid-check.tsx") {
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((result) => result.messages).filter((message) => message.ruleId === "no-restricted-properties");
}

describe("HTTP UUID compatibility guard", () => {
  it.each([
    "export const id = crypto.randomUUID();",
    "export const id = window.crypto.randomUUID();",
    "export const id = globalThis.crypto.randomUUID();",
    "export const id = crypto['randomUUID']();",
    "const { randomUUID: generateId } = crypto; export const id = generateId();",
  ])("rejects a direct UUID dependency: %s", async (code) => {
    expect(await restrictedMessages(code)).toHaveLength(1);
  });

  it("allows the shared wrapper, its native implementation and named Node imports", async () => {
    expect(await restrictedMessages('import { createUuid } from "@/lib/uuid"; export const id = createUuid();')).toEqual([]);
    expect(await restrictedMessages("export const id = globalThis.crypto.randomUUID();", "lib/uuid.ts")).toEqual([]);
    expect(await restrictedMessages('import { randomUUID } from "node:crypto"; export const id = randomUUID();', "lib/ai/server-uuid-check.ts")).toEqual([]);
  });
});
