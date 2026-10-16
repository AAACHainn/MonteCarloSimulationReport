import { afterEach, describe, expect, it, vi } from "vitest";
import { generateTurn } from "./provider";
import { endpointSchema } from "./schema";
import { resolveLimits } from "./limits";
const endpoint = endpointSchema.parse({ id: "mock", name: "mock", baseUrl: "http://localhost:9999/v1", defaultModel: "mock" });
const tools = [{ type: "function" as const, function: { name: "get_review_template", description: "template", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } }];
const signal = new AbortController().signal;
function response(deltas: unknown[], finish = "tool_calls", done = true, split = false) {
  const wire = deltas.map((delta) => "data: " + JSON.stringify({ choices: [{ delta, finish_reason: null }] }) + "\r\n\r\n").join("")
    + "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) + "\r\n\r\n" + (done ? "data: [DONE]\r\n\r\n" : "");
  const bytes = new TextEncoder().encode(wire);
  return new Response(new ReadableStream({ start(c) { if (split) for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); else c.enqueue(bytes); c.close(); } }));
}
function part(index: number, id?: string, name?: string, args?: string) { return { tool_calls: [{ index, ...(id ? { id } : {}), type: "function", function: { ...(name ? { name } : {}), ...(args !== undefined ? { arguments: args } : {}) } }] }; }
afterEach(() => vi.unstubAllGlobals());
describe("A: streaming tool protocol boundaries", () => {
  it("assembles interleaved indices from byte-sized UTF-8/CRLF chunks with IDs/names only on the first fragments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([
      { reasoning_content: "核对中文与😀" }, part(1, "second", "get_review_template", "{"), part(0, "first", "get_review_template", "{"), part(1, undefined, undefined, "}"), part(0, undefined, undefined, "}"),
    ], "tool_calls", true, true)));
    const turn = await generateTurn(endpoint, "mock", [], signal, undefined, undefined, {}, { tools });
    expect(turn.assistant.tool_calls?.map((c) => [c.id, c.function.arguments])).toEqual([["first", "{}"], ["second", "{}"]]);
    expect(turn.assistant.reasoning_content).toBe("核对中文与😀"); expect(turn.content).toBe(""); expect(turn.usage).toEqual({ input: null, output: null });
  });
  it.each([
    [[part(0, "one", "get_review_template", "{")], "tool_calls", true],
    [[part(0, "one", "get_review_template", "{}")], "tool_calls", false],
    [[part(0, "one", "get_review_template", "{}")], "length", true],
    [[part(0, "one", "get_review_template", "{}"), part(0, "other")], "tool_calls", true],
    [[part(0, "one", "get_review_template", "{}"), part(0, undefined, "other")], "tool_calls", true],
    [[part(4, "one", "get_review_template", "{}")], "tool_calls", true],
    [[part(0, "one", "get_review_template", "x".repeat(16385))], "tool_calls", true],
    [[{ refusal: "refused" }], "stop", true],
  ])("rejects malformed, conflicting, oversized, truncated or refused tool rounds (%#)", async (deltas, finish, done) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(deltas as unknown[], finish as string, done as boolean)));
    await expect(generateTurn(endpoint, "mock", [], signal, undefined, undefined, {}, { tools })).rejects.toThrow();
  });
  it("does not interpret JSON/Markdown prose as an invocation, and rejects new calls during closing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ content: '```json\n{"name":"get_review_template","arguments":{}}\n```' }], "stop")));
    expect((await generateTurn(endpoint, "mock", [], signal, undefined, undefined, {}, { tools })).assistant.tool_calls).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([part(0, "one", "get_review_template", "{}")])));
    await expect(generateTurn(endpoint, "mock", [], signal, undefined, undefined, {}, { tools, closing: true })).rejects.toThrow();
  });
});
describe("configurable model output and failure usage", () => {
  it.each(["max_tokens", "max_completion_tokens"] as const)("sends the requested %s and retains usage when output is cut off", async (parameter) => {
    const mock = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"reasoning_content":"部分思考"},"finish_reason":"length"}],"usage":{"prompt_tokens":123,"completion_tokens":8192}}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal("fetch", mock);
    const onUsage = vi.fn(), onDetails = vi.fn();
    await expect(generateTurn({ ...endpoint, tokenParameter: parameter }, "mock", [], signal, undefined, undefined, { onUsage, onDetails }, { limits: resolveLimits({ outputTokens: 8192 }) }))
      .rejects.toMatchObject({ code: "BUDGET", budget: { resource: "outputTokens", used: 8192, limit: 8192 } });
    const body = JSON.parse(mock.mock.calls[0][1].body);
    expect(body[parameter]).toBe(8192); expect(body[parameter === "max_tokens" ? "max_completion_tokens" : "max_tokens"]).toBeUndefined();
    expect(onUsage).toHaveBeenCalledWith({ input: 123, output: 8192 });
    expect(onDetails).toHaveBeenCalledWith(expect.objectContaining({ usage: { input: 123, output: 8192 }, outputTokenLimit: 8192, finishReason: "length", reasoning: "部分思考" }));
  });
  it("supports a larger response in nonstream mode and treats malformed usage as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { role: "assistant", content: "x".repeat(65000) }, finish_reason: "stop" }], usage: { prompt_tokens: -2, completion_tokens: "15000" } })));
    const turn = await generateTurn({ ...endpoint, toolTransport: "nonstream" }, "mock", [], signal, undefined, undefined, {}, { tools, limits: resolveLimits({ outputTokens: 8192 }) });
    expect(turn.content).toHaveLength(65000); expect(turn.usage).toEqual({ input: null, output: null });
  });
});
