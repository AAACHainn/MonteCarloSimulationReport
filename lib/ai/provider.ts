import { copy } from "@/lib/i18n";
import { endpointUrls, revealKey } from "./config";
import { AiError } from "./errors";
import { outputJsonSchema, type Endpoint } from "./schema";
import type { ResponseDetails } from "./response-details";
import { resolveLimits, outputCharLimit, type AiLimits } from "./limits";
import { budgetError } from "./budget";

export type ToolRequest = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolDefinition = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean } };
export type ModelMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>; tool_calls?: ToolRequest[]; tool_call_id?: string; reasoning_content?: string; reasoning?: string };
export type ModelTurn = { content: string; usage: Usage; assistant: ModelMessage; finish: "stop" | "tool_calls" };
type ModelOptions = { tools?: ToolDefinition[]; closing?: boolean; limits?: AiLimits };
export function modelRequest(endpoint: Endpoint, model: string, messages: ModelMessage[], json?: "reviewDraft" | "sessionReview", options: ModelOptions = {}) {
  return { model, messages: endpoint.adapterProfile === "deepseek" ? messages : messages.map((message) => { const wire = { ...message }; delete wire.reasoning_content; delete wire.reasoning; return wire; }),
    stream: !(options.tools?.length && endpoint.toolTransport === "nonstream" && !options.closing), [endpoint.tokenParameter ?? "max_tokens"]: resolveLimits(options.limits).outputTokens,
    ...(options.tools?.length ? { tools: options.tools, tool_choice: options.closing ? "none" : "auto" } : {}),
    ...(json && endpoint.capabilities[model]?.structured === "SUPPORTED" ? { response_format: { type: "json_schema", json_schema: { name: json, strict: true, schema: outputJsonSchema(json) } } } : {}) };
}
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
export async function* sseData(body: ReadableStream<Uint8Array>, signal: AbortSignal, maxBytes = 2 * 1024 * 1024) {
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
      if (buffer.length > 65536 || bytes > maxBytes) throw new AiError("UPSTREAM_SIZE", copy.ai.tooLarge, 502);
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
): Promise<{ content: string; usage: Usage }> {
  const { content, usage } = await generateTurn(endpoint, model, messages, signal, onDelta, json, observer);
  return { content, usage };
}
export async function generateTurn(
  endpoint: Endpoint, model: string, messages: ModelMessage[], signal: AbortSignal,
  onDelta: (text: string) => void = () => undefined, json?: "reviewDraft" | "sessionReview",
  observer: { onReasoning?: (text: string) => void; onDetails?: (details: ResponseDetails) => void; onUsage?: (usage: Usage) => void } = {},
  options: ModelOptions = {},
): Promise<ModelTurn> {
  const started = Date.now();
  const limits = resolveLimits(options.limits), maxOutputChars = outputCharLimit(limits);
  let usage: Usage = { input: null, output: null }, finish: string | null = null;
  let reasoning = "", reasoningEnded: number | null = null;
  try {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(limits.modelSeconds * 1000)]);
    let response: Response;
    const body = modelRequest(endpoint, model, messages, json, options), stream = body.stream;
    try {
      response = await fetch(endpointUrls(endpoint).chat, {
        method: "POST", redirect: "error", signal: combined, headers: requestHeaders(endpoint),
        body: JSON.stringify(body),
      });
    } catch { signal.throwIfAborted(); if (combined.aborted) throw budgetError("modelSeconds", limits.modelSeconds, limits.modelSeconds); throw new AiError("NETWORK", copy.ai.interrupted, 502); }
    if (!response.ok) { await response.body?.cancel(); throw new AiError(options.tools?.length && [400, 422].includes(response.status) ? "TOOLS_REJECTED" : "UPSTREAM", response.status === 401 || response.status === 403 ? copy.ai.auth : options.tools?.length && [400, 422].includes(response.status) ? copy.ai.toolsRejected : copy.ai.remote, 502); }
    if (!response.body) throw new AiError("INCOMPLETE", copy.ai.incomplete, 502);
    let content = "", done = false;
    const calls = new Map<number, ToolRequest>();
    const thoughtFields: Record<string, string> = {};
    try {
      async function* chunks() {
        if (stream) yield* sseData(response.body!, combined, Math.max(2 * 1024 * 1024, maxOutputChars * 64));
        else {
          const value = await boundedJson(response, Math.max(1024 * 1024, maxOutputChars * 4));
          const choice = value.choices?.[0];
          if (!choice?.message || choice.message.role !== "assistant") throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
          const tool_calls = choice.message.tool_calls?.map((c: ToolRequest, index: number) => ({ ...c, index }));
          yield JSON.stringify({ ...value, choices: [{ ...choice, delta: { ...choice.message, tool_calls } }] });
          yield "[DONE]";
        }
      }
      for await (const data of chunks()) {
        if (data === "[DONE]") { done = true; break; }
        let chunk;
        try { chunk = JSON.parse(data); } catch { throw new AiError("PROTOCOL", copy.ai.incomplete, 502); }
        if (chunk.error) throw new AiError("UPSTREAM", copy.ai.remote, 502);
        if (chunk.usage) {
          usage = { input: Number.isSafeInteger(chunk.usage.prompt_tokens) && chunk.usage.prompt_tokens >= 0 ? chunk.usage.prompt_tokens : null,
            output: Number.isSafeInteger(chunk.usage.completion_tokens) && chunk.usage.completion_tokens >= 0 ? chunk.usage.completion_tokens : null };
          observer.onUsage?.(usage);
        }
        const choice = chunk.choices?.[0];
        if (chunk.choices?.length > 1 || (choice?.delta?.role && choice.delta.role !== "assistant")
          || (finish && (choice?.delta?.content || choice?.delta?.reasoning_content || choice?.delta?.reasoning || choice?.delta?.tool_calls || choice?.finish_reason))) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
        if (choice?.delta?.refusal || choice?.message?.refusal) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
        if (choice?.delta?.tool_calls) {
          if (!options.tools?.length || finish || !Array.isArray(choice.delta.tool_calls)) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
          for (const part of choice.delta.tool_calls) {
            if (!Number.isInteger(part.index) || part.index < 0 || part.index > 3 || (part.type && part.type !== "function")) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
            const call = calls.get(part.index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
            if (part.id !== undefined) {
              if (typeof part.id !== "string" || (call.id && call.id !== part.id)) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
              call.id = part.id;
            }
            if (part.function?.name !== undefined) {
              if (typeof part.function.name !== "string" || (call.function.name && call.function.name !== part.function.name)) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
              call.function.name = part.function.name;
            }
            if (part.function?.arguments !== undefined) {
              if (typeof part.function.arguments !== "string") throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
              call.function.arguments += part.function.arguments;
            }
            if (Buffer.byteLength(call.function.arguments) > 16384 || call.id.length > 160 || call.function.name.length > 100) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
            calls.set(part.index, call);
          }
          const size = [...calls.values()].reduce((n, call) => n + call.function.arguments.length, 0) + content.length + reasoning.length;
          if (size > maxOutputChars) throw budgetError("outputChars", size, maxOutputChars);
        }
        // Only consume text explicitly exposed by the service; opaque reasoning is ignored.
        const thought = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
        const argumentChars = [...calls.values()].reduce((n, call) => n + call.function.arguments.length, 0);
        if (typeof thought === "string" && thought) {
          if (content.length + reasoning.length + thought.length + argumentChars > maxOutputChars) throw budgetError("outputChars", content.length + reasoning.length + thought.length + argumentChars, maxOutputChars);
          reasoning += thought;
          const field = typeof choice.delta.reasoning_content === "string" ? "reasoning_content" : "reasoning";
          thoughtFields[field] = (thoughtFields[field] ?? "") + thought;
          observer.onReasoning?.(thought);
        }
        if (typeof choice?.delta?.content === "string" && choice.delta.content) {
          if (reasoningEnded === null) reasoningEnded = Date.now();
          content += choice.delta.content;
          if (content.length + reasoning.length + argumentChars > maxOutputChars) throw budgetError("outputChars", content.length + reasoning.length + argumentChars, maxOutputChars);
          onDelta(choice.delta.content);
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
      signal.throwIfAborted();
      const toolCalls = [...calls].sort(([a], [b]) => a - b).map(([, c]) => c);
      if (finish === "length") throw budgetError("outputTokens", usage.output, limits.outputTokens);
      if (!done || !["stop", "tool_calls"].includes(finish ?? "") || (finish === "stop" && (!content.trim() || toolCalls.length))
        || (finish === "tool_calls" && (!toolCalls.length || options.closing))) throw new AiError("INCOMPLETE", copy.ai.incomplete, 502);
      if (new Set(toolCalls.map((c) => c.id)).size !== toolCalls.length || toolCalls.some((c) => !c.id || !c.function.name)) throw new AiError("PROTOCOL", copy.ai.incomplete, 502);
      // JSON must be complete before any call can be persisted/executed.
      for (const call of toolCalls) { try { JSON.parse(call.function.arguments); } catch { throw new AiError("PROTOCOL", copy.ai.incomplete, 502); } }
      return { content, usage, finish: finish as ModelTurn["finish"], assistant: { role: "assistant", content: content || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...thoughtFields } };
    } catch (error) {
      if (error instanceof AiError) throw error;
      signal.throwIfAborted(); if (combined.aborted) throw budgetError("modelSeconds", limits.modelSeconds, limits.modelSeconds); throw new AiError("NETWORK", copy.ai.interrupted, 502);
    }
  } finally {
    const ended = Date.now();
    observer.onDetails?.({ startedAt: new Date(started).toISOString(), durationMs: Math.max(0, ended - started), reasoning,
      reasoningMs: reasoning ? Math.max(0, (reasoningEnded ?? ended) - started) : null, usage, outputTokenLimit: limits.outputTokens, finishReason: finish });
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
