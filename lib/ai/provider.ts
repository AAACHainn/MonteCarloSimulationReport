import { copy } from "@/lib/i18n";
import { endpointUrls, revealKey } from "./config";
import { AiError } from "./errors";
import { LIMITS, outputJsonSchema, type Endpoint } from "./schema";
import type { ResponseDetails } from "./response-details";

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
  observer: { onReasoning?: (text: string) => void; onDetails?: (details: ResponseDetails) => void } = {},
) {
  const started = Date.now();
  let reasoning = "", reasoningEnded: number | null = null;
  try {
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
        // Only consume text explicitly exposed by the service; opaque reasoning is ignored.
        const thought = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
        if (typeof thought === "string" && thought) {
          if (content.length + reasoning.length + thought.length > LIMITS.outputChars) throw new AiError("OUTPUT_LIMIT", copy.ai.budget);
          reasoning += thought;
          observer.onReasoning?.(thought);
        }
        if (typeof choice?.delta?.content === "string" && choice.delta.content) {
          if (reasoningEnded === null) reasoningEnded = Date.now();
          content += choice.delta.content;
          if (content.length + reasoning.length > LIMITS.outputChars) throw new AiError("OUTPUT_LIMIT", copy.ai.budget);
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
  } finally {
    const ended = Date.now();
    observer.onDetails?.({ startedAt: new Date(started).toISOString(), durationMs: Math.max(0, ended - started), reasoning,
      reasoningMs: reasoning ? Math.max(0, (reasoningEnded ?? ended) - started) : null });
  }
}
export async function testConnection(endpoint: Endpoint, model: string) {
  const data = await boundedJson(await fetch(endpointUrls(endpoint).chat, {
    method: "POST", redirect: "error", headers: requestHeaders(endpoint), signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model, stream: false, [endpoint.tokenParameter ?? "max_tokens"]: 100, messages: [{ role: "user", content: "Reply OK." }] }),
  }));
  // This checks access to the selected model, without inferring image, tool or schema capabilities.
  // A reasoning model may consume the small output budget before producing visible text.
  if (data.error || !Array.isArray(data.choices) || !data.choices[0]?.message) throw new AiError("CONNECTION", copy.ai.connectionFailed, 502);
}
