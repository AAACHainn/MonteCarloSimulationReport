import { copy } from "@/lib/i18n";
import { endpointUrls, revealKey } from "./config";
import { AiError } from "./errors";
import { LIMITS, outputJsonSchema, type Capability, type Endpoint } from "./schema";
import { deflateSync } from "node:zlib";
import { randomInt } from "node:crypto";

export type ModelMessage = { role: "system" | "user" | "assistant"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> };
export type Usage = { input: number | null; output: number | null };
export function requestHeaders(endpoint: Endpoint) {
  const key = revealKey(endpoint.encryptedKey);
  return { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) };
}
export async function boundedJson(response: Response, max = 262144) {
  if (!response.ok) throw new AiError(response.status === 401 || response.status === 403 ? "AUTH" : "UPSTREAM", response.status === 401 || response.status === 403 ? copy.ai.auth : copy.ai.remote, 502);
  const reader = response.body?.getReader();
  if (!reader) throw new AiError("INCOMPLETE", copy.ai.incomplete, 502);
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
      if (size > max) throw new AiError("UPSTREAM_SIZE", copy.ai.tooLarge, 502); chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); }
}
/** SSE boundaries can split UTF-8, CRLF, JSON and multiple data lines arbitrarily. */
export async function* sseData(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "", event: string[] = [], bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      buffer += decoder.decode(part.value, { stream: !part.done });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ""); buffer = buffer.slice(end + 1);
        if (!line) { if (event.length) { yield event.join("\n"); event = []; } }
        else if (line.startsWith("data:")) event.push(line.slice(5).replace(/^ /, ""));
      }
      bytes += part.value?.length ?? 0;
      if (buffer.length > 65536 || bytes > 2 * 1024 * 1024) throw new AiError("UPSTREAM_SIZE", copy.ai.tooLarge, 502);
      if (part.done) break;
    }
    if (buffer.startsWith("data:")) event.push(buffer.slice(5).trim());
    if (event.length) yield event.join("\n");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function generate(
  endpoint: Endpoint, model: string, messages: ModelMessage[], signal: AbortSignal,
  onDelta: (text: string) => void = () => undefined, json?: "reviewDraft" | "sessionReview",
) {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(LIMITS.modelMs)]);
  let response: Response;
  try {
    response = await fetch(endpointUrls(endpoint).chat, {
      method: "POST", redirect: "error", signal: combined, headers: requestHeaders(endpoint),
      body: JSON.stringify({ model, messages, stream: true, [endpoint.tokenParameter ?? "max_tokens"]: LIMITS.outputTokens,
        ...(json && endpoint.capabilities[model]?.structured === "SUPPORTED" ? { response_format: { type: "json_schema", json_schema: { name: json, strict: true, schema: outputJsonSchema(json) } } } : {}),
      }),
    });
  } catch { signal.throwIfAborted(); throw new AiError("NETWORK", copy.ai.interrupted, 502); }
  if (!response.ok) { await response.body?.cancel(); throw new AiError("UPSTREAM", response.status === 401 || response.status === 403 ? copy.ai.auth : copy.ai.remote, 502); }
  if (!response.body) throw new AiError("INCOMPLETE", copy.ai.incomplete, 502);
  let content = "", finish: string | null = null, done = false;
  let usage: Usage = { input: null, output: null };
  try {
    for await (const data of sseData(response.body, combined)) {
      if (data === "[DONE]") { done = true; break; }
      let chunk;
      try { chunk = JSON.parse(data); } catch { throw new AiError("PROTOCOL", copy.ai.incomplete, 502); }
      if (chunk.error) throw new AiError("UPSTREAM", copy.ai.remote, 502);
      if (chunk.usage) usage = {
        input: Number.isFinite(chunk.usage.prompt_tokens) ? chunk.usage.prompt_tokens : null,
        output: Number.isFinite(chunk.usage.completion_tokens) ? chunk.usage.completion_tokens : null,
      };
      const choice = chunk.choices?.[0];
      if (choice?.delta?.tool_calls || choice?.delta?.refusal) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
      if (typeof choice?.delta?.content === "string") {
        content += choice.delta.content;
        if (content.length > LIMITS.outputChars) throw new AiError("OUTPUT_LIMIT", copy.ai.budget);
        onDelta(choice.delta.content);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
    signal.throwIfAborted();
    if (!done || finish !== "stop" || !content.trim()) throw new AiError("INCOMPLETE", copy.ai.incomplete, 502);
    return { content, usage };
  } catch (error) {
    if (error instanceof AiError) throw error;
    signal.throwIfAborted(); throw new AiError("NETWORK", copy.ai.interrupted, 502);
  }
}
export async function probe(endpoint: Endpoint, model: string, capability: Capability) {
  const tool = { type: "function", function: { name: "connection_probe", description: "Temporary read-only connectivity probe.", parameters: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } };
  const text = capability === "tools" ? 'Call connection_probe with {"ok":true}.' : capability === "structured" ? 'Return JSON {"ok":true}.' : capability === "vision" ? "Identify the solid color in this image. Reply with only the English color name." : "Reply OK.";
  const blue = randomInt(2) === 1;
  const pixel = colorProbeImage(blue);
  const data = await boundedJson(await fetch(endpointUrls(endpoint).chat, {
    method: "POST", redirect: "error", headers: requestHeaders(endpoint), signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model, stream: false, [endpoint.tokenParameter ?? "max_tokens"]: 100, messages: [{ role: "user", content: capability === "vision" ? [{ type: "text", text }, { type: "image_url", image_url: { url: pixel } }] : text }],
      ...(capability === "tools" ? { tools: [tool], tool_choice: { type: "function", function: { name: "connection_probe" } } } : {}),
      ...(capability === "structured" ? { response_format: { type: "json_schema", json_schema: { name: "probe", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } } } : {}),
    }),
  }));
  const choice = data.choices?.[0], message = choice?.message;
  if (choice?.finish_reason !== (capability === "tools" ? "tool_calls" : "stop")) throw new AiError("PROBE", copy.ai.incomplete);
  if (capability === "tools") {
    const calls = message?.tool_calls;
    const args = calls?.length === 1 ? JSON.parse(calls[0].function.arguments) : null;
    if (calls?.length !== 1 || calls[0].function?.name !== "connection_probe" || !calls[0].id || args?.ok !== true || Object.keys(args).length !== 1) throw new AiError("PROBE", copy.ai.remote);
  } else if (capability === "structured") {
    if (JSON.parse(message?.content).ok !== true) throw new AiError("PROBE", copy.ai.remote);
  } else if (!message?.content || (capability === "vision" && !String(message.content).toLowerCase().includes(blue ? "blue" : "red"))) throw new AiError("PROBE", copy.ai.incomplete);
}
function colorProbeImage(blue: boolean) {
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    let value = 0xffffffff;
    for (const byte of body) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; }
    crc.writeUInt32BE((value ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, crc]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(16, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(16 * 49);
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) raw[row * 49 + 1 + col * 3 + (blue ? 2 : 0)] = 255;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
