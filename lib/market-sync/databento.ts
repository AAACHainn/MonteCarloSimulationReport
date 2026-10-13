import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { parse } from "csv-parse";
import { copy } from "@/lib/i18n";
import { normalizeCmeOutrightSymbol } from "@/lib/market-replay/cme-contracts";
import { parseMarketTimestamp } from "@/lib/market-replay/parse-market-bars";
import { SyncError } from "./security";
import type { SyncBar, SyncProfile } from "./types";

const API = "https://hist.databento.com/v0/";
type SymbolMapping = { d0: string; d1: string; s: string };
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
// Read only a bounded error body; never surface provider messages or payloads that may echo credentials.
async function errorDetail(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (bytes <= 16384) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 16384) return null;
      chunks.push(part.value);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return result?.detail && !Array.isArray(result.detail) ? result.detail : null;
  } catch { return null; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function schemaFor(interval: number) { return ({ 1: "ohlcv-1s", 60: "ohlcv-1m", 3600: "ohlcv-1h", 86400: "ohlcv-1d" } as Record<number, string>)[interval]; }
export function symbolFor(profile: SyncProfile) { return profile.contractMode === "CONTINUOUS" ? `${profile.root}.v.0` : profile.contract; }
export interface MarketProvider {
  range(profile: SyncProfile, signal: AbortSignal): Promise<{ start: Date; end: Date }>;
  conditions(start: Date, end: Date, signal: AbortSignal): Promise<Array<{ date: string; condition: string }>>;
  cost(profile: SyncProfile, start: Date, end: Date, signal: AbortSignal): Promise<number>;
  bars(profile: SyncProfile, start: Date, end: Date, signal: AbortSignal): AsyncIterable<SyncBar>;
}
export class DatabentoProvider implements MarketProvider {
  constructor(private key: string, private fetcher: typeof fetch = fetch) {}
  private async request(method: string, params: Record<string, string>, signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.requestOnce(method, params, signal); }
      catch (error) {
        const retryable = !(error instanceof SyncError) || error.status === 429 || error.status >= 500;
        if (method === "timeseries.get_range" || signal.aborted || !retryable || attempt >= 3) throw error;
        await delay((error as { retryAfter?: number }).retryAfter ?? 1000 * 2 ** attempt, undefined, { signal });
      }
    }
  }
  private async requestOnce(method: string, params: Record<string, string>, signal: AbortSignal) {
    const url = new URL(API + method); const values = new URLSearchParams(params);
    const post = method === "timeseries.get_range" || method === "symbology.resolve";
    if (!post) url.search = values.toString();
    const response = await this.fetcher(url, { method: post ? "POST" : "GET", body: post ? values : undefined, headers: { Authorization: `Basic ${Buffer.from(this.key + ":").toString("base64")}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(method === "timeseries.get_range" ? 300000 : 30000)]), cache: "no-store", redirect: "error" });
    if (!response.ok) {
      const detail = await errorDetail(response);
      const errorCase = typeof detail?.case === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(detail.case) && !detail.case.includes(this.key) ? detail.case : null;
      const denied = [401, 403].includes(response.status) || errorCase === "dataset_unavailable_range";
      let message = errorCase === "dataset_unavailable_range" ? copy.marketSync.entitlement : denied ? copy.marketSync.auth : response.status === 402 ? copy.marketSync.payment : errorCase === "symbology_invalid_request" ? copy.marketSync.symbology : copy.marketSync.failed;
      const availableEnd = detail?.payload?.available_end;
      if (errorCase === "dataset_unavailable_range" && typeof availableEnd === "string" && Number.isFinite(Date.parse(availableEnd))) message += " " + copy.marketSync.entitlementThrough(new Date(availableEnd).toISOString());
      const error = new SyncError(copy.marketSync.providerError(message, response.status, errorCase), response.status, denied ? "AUTH" : "HTTP", { method, case: errorCase });
      const retry = response.headers.get("retry-after");
      Object.assign(error, { retryAfter: retry ? Math.max(0, /^\d+$/.test(retry) ? Number(retry) * 1000 : new Date(retry).getTime() - Date.now()) : undefined });
      throw error;
    }
    return response;
  }
  private params(profile: SyncProfile, start: Date, end: Date) { return { dataset: "GLBX.MDP3", symbols: symbolFor(profile), stype_in: profile.contractMode === "CONTINUOUS" ? "continuous" : "raw_symbol", schema: schemaFor(profile.interval), start: start.toISOString(), end: end.toISOString() }; }
  async range(profile: SyncProfile, signal: AbortSignal) {
    const response = await this.request("metadata.get_dataset_range", { dataset: "GLBX.MDP3" }, signal);
    const result = await response.json(); const range = result.schema?.[schemaFor(profile.interval)] ?? result.schemas?.[schemaFor(profile.interval)];
    if (!range?.start || !range.end || !Number.isFinite(Date.parse(range.end)) || !Number.isFinite(Date.parse(range.start))) throw new SyncError(copy.marketSync.unavailable, 400, "RANGE");
    return { start: new Date(range.start), end: new Date(range.end) };
  }
  async conditions(start: Date, end: Date, signal: AbortSignal) {
    const response = await this.request("metadata.get_dataset_condition", { dataset: "GLBX.MDP3", start_date: start.toISOString().slice(0, 10), end_date: new Date(end.getTime() - 1).toISOString().slice(0, 10) }, signal);
    return await response.json() as Array<{ date: string; condition: string }>;
  }
  async cost(profile: SyncProfile, start: Date, end: Date, signal: AbortSignal) {
    const response = await this.request("metadata.get_cost", this.params(profile, start, end), signal);
    const cost = await response.json();
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) throw new SyncError(copy.marketSync.budget, 400, "BUDGET");
    return cost;
  }
  private async resolveInstrument(instrumentId: string, profile: SyncProfile, start: Date, end: Date, signal: AbortSignal): Promise<SymbolMapping[]> {
    // The HTTP endpoint accepts precise timestamps and returns dated mappings.
    // Rounding the request to midnight can cross the account's intraday entitlement.
    const response = await this.request("symbology.resolve", { dataset: "GLBX.MDP3", symbols: instrumentId, stype_in: "instrument_id", stype_out: "raw_symbol", start_date: start.toISOString(), end_date: end.toISOString() }, signal);
    const result = await response.json(); const mappings = result?.result?.[instrumentId];
    if (!Array.isArray(mappings) || !mappings.length || mappings.some((value) => !validDate(value?.d0) || !validDate(value?.d1) || value.d0 >= value.d1 || typeof value.s !== "string" || !normalizeCmeOutrightSymbol(value.s, profile.root))) throw new SyncError(copy.marketSync.invalid, 400, "DATA");
    return mappings;
  }
  async *bars(profile: SyncProfile, start: Date, end: Date, signal: AbortSignal) {
    // Both continuous and raw-symbol inputs may only output instrument IDs. Resolve each
    // returned ID to the actual dated contract using free metadata, preserving ROOT.v.0.
    const response = await this.request("timeseries.get_range", { ...this.params(profile, start, end), encoding: "csv", compression: "none", pretty_px: "true", pretty_ts: "true", map_symbols: "false", stype_out: "instrument_id" }, signal);
    if (!response.body) throw new SyncError(copy.marketSync.failed, 502, "HTTP");
    const stream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
    const parser = stream.pipe(parse({ columns: true, bom: true, skip_empty_lines: true }));
    stream.on("error", (error) => parser.destroy(error));
    const instruments = new Map<string, SymbolMapping[]>();
    try {
      for await (const row of parser as AsyncIterable<Record<string, string>>) {
        signal.throwIfAborted();
        const timestamp = parseMarketTimestamp(row.ts_event, "UTC");
        const values = [row.open, row.high, row.low, row.close].map((value) => value?.trim() ? Number(value) : NaN);
        const volume = row.volume?.trim() ? Number(row.volume) : null;
        if (!timestamp || !/^\d+$/.test(row.instrument_id ?? "") || values.some((v) => !Number.isFinite(v)) || (volume !== null && (!Number.isFinite(volume) || volume < 0))
          || values[1] < Math.max(values[0], values[2], values[3]) || values[2] > Math.min(values[0], values[1], values[3])
          || timestamp.getTime() < start.getTime() || timestamp.getTime() + profile.interval * 1000 > end.getTime()
          || timestamp.getTime() % (profile.interval * 1000) !== 0) throw new SyncError(copy.marketSync.invalid, 400, "DATA");
        if (!instruments.has(row.instrument_id)) instruments.set(row.instrument_id, await this.resolveInstrument(row.instrument_id, profile, start, end, signal));
        const day = timestamp.toISOString().slice(0, 10);
        const matching = instruments.get(row.instrument_id)!.filter((value) => value.d0 <= day && day < value.d1);
        const symbol = matching.length === 1 ? normalizeCmeOutrightSymbol(matching[0].s, profile.root) : null;
        if (!symbol || (profile.contractMode === "OUTRIGHT" && symbol !== profile.contract)) throw new SyncError(copy.marketSync.invalid, 400, "DATA");
        yield { timestamp, open: values[0], high: values[1], low: values[2], close: values[3], volume, symbol };
      }
    } finally { parser.destroy(); stream.destroy(); }
  }
}
