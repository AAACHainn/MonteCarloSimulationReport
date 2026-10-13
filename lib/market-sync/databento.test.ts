import { describe, expect, it, vi } from "vitest";
import { DatabentoProvider } from "./databento";
import type { SyncProfile } from "./types";
const profile = { root: "ES", interval: 60, contractMode: "CONTINUOUS" as const, contract: "" };
const signal = () => new AbortController().signal;
const start = new Date("2026-09-01T00:00:00Z");
const end = new Date("2026-09-01T00:02:00Z");
const header = "ts_event,rtype,instrument_id,open,high,low,close,volume\n";
const row = (timestamp = "2026-09-01T00:00:00Z", id = "123") => `${timestamp},33,${id},100,102,99,101,10\n`;
const mapping = (id = "123", symbol = "ESU6", d0 = "2026-09-01", d1 = "2026-09-02") => Response.json({ result: { [id]: [{ d0, d1, s: symbol }] } });
async function consume(source: DatabentoProvider, p: SyncProfile = profile, from = start, through = end) {
  const values = []; for await (const value of source.bars(p, from, through, signal())) values.push(value); return values;
}
describe("Databento HTTP adapter", () => {
  it("uses the schema's entitled range rather than the global range", async () => {
    const source = new DatabentoProvider("mock-key", vi.fn().mockResolvedValue(Response.json({ end: "2026-10-13T12:00:00Z", schema: { "ohlcv-1m": { start: "2021-01-01T00:00:00Z", end: "2026-10-12T00:00:00Z" } } })));
    expect((await source.range(profile, signal())).end.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
  it("downloads continuous instrument IDs with POST form data and resolves the dated actual contract", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(header + row() + row("2026-09-01T00:01:00Z"))).mockResolvedValueOnce(mapping());
    const values = await consume(new DatabentoProvider("mock-key", fetcher));
    expect(values).toHaveLength(2); expect(values[0]).toMatchObject({ close: 101, symbol: "ESU6", volume: 10 });
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.search).toBe(""); expect(options.method).toBe("POST");
    const body = options.body as URLSearchParams;
    expect(Object.fromEntries(body)).toMatchObject({ symbols: "ES.v.0", stype_in: "continuous", stype_out: "instrument_id", map_symbols: "false", pretty_px: "true", pretty_ts: "true" });
    const [resolveUrl, resolveOptions] = fetcher.mock.calls[1] as [URL, RequestInit];
    expect(resolveUrl.pathname).toBe("/v0/symbology.resolve"); expect(resolveOptions.method).toBe("POST");
    expect(Object.fromEntries(resolveOptions.body as URLSearchParams)).toMatchObject({ symbols: "123", stype_in: "instrument_id", stype_out: "raw_symbol", start_date: start.toISOString(), end_date: end.toISOString() });
    expect(fetcher).toHaveBeenCalledTimes(2); // Resolve once per ID, not once per candle.
  });
  it("keeps reverse symbol requests inside a partial UTC day's entitled range", async () => {
    const from = new Date("2026-10-12T00:00:00Z"); const through = new Date("2026-10-12T23:35:00Z");
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("timeseries.get_range")) return new Response(header + row("2026-10-12T23:34:00Z"));
      const params = options?.body as URLSearchParams;
      if (Date.parse(params.get("end_date")!) > through.getTime()) return Response.json({ detail: { case: "dataset_unavailable_range", payload: { available_end: through.toISOString() } } }, { status: 422 });
      expect(params.get("start_date")).toBe(from.toISOString());
      expect(params.get("end_date")).toBe(through.toISOString());
      return mapping("123", "ESZ6", "2026-10-12", "2026-10-13");
    });
    const values = await consume(new DatabentoProvider("mock-key", fetcher), profile, from, through);
    expect(values).toHaveLength(1); expect(values[0]).toMatchObject({ timestamp: new Date("2026-10-12T23:34:00Z"), symbol: "ESZ6" });
  });
  it("rejects partial candles and malformed market prices", async () => {
    for (const [csv, through] of [[header + row(), new Date("2026-09-01T00:00:30Z")], [header + row().replace(",100,102,", ",bad,102,"), end]] as const) {
      const fetcher = vi.fn().mockResolvedValue(new Response(csv));
      await expect(consume(new DatabentoProvider("mock-key", fetcher), profile, start, through)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("keeps supplier roll mappings and handles the same ID being remapped on different dates", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(header + row() + row("2026-09-02T00:00:00Z")))
      .mockResolvedValueOnce(Response.json({ result: { "123": [{ d0: "2026-09-01", d1: "2026-09-02", s: "ESU6" }, { d0: "2026-09-02", d1: "2026-09-03", s: "ESZ6" }] } }));
    const values = await consume(new DatabentoProvider("mock-key", fetcher), profile, start, new Date("2026-09-03T00:00:00Z"));
    expect(values.map((v) => v.symbol)).toEqual(["ESU6", "ESZ6"]);
  });
  it("resolves every actual ID returned across a contract roll", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(header + row() + row("2026-09-02T00:00:00Z", "456")))
      .mockResolvedValueOnce(mapping()).mockResolvedValueOnce(mapping("456", "ESZ6", "2026-09-02", "2026-09-03"));
    expect((await consume(new DatabentoProvider("mock-key", fetcher), profile, start, new Date("2026-09-03T00:00:00Z"))).map((v) => v.symbol)).toEqual(["ESU6", "ESZ6"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("also uses the valid raw-symbol to instrument-ID pair for outright contracts", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(header + row())).mockResolvedValueOnce(mapping());
    await consume(new DatabentoProvider("mock-key", fetcher), { ...profile, contractMode: "OUTRIGHT", contract: "ESU6" });
    expect(Object.fromEntries(fetcher.mock.calls[0][1].body as URLSearchParams)).toMatchObject({ symbols: "ESU6", stype_in: "raw_symbol", stype_out: "instrument_id" });
  });
  it.each(["missing", "wrong root", "ambiguous", "out of range"])("rejects %s reverse mappings", async (problem) => {
    const response = problem === "missing" ? Response.json({ result: {} }) : problem === "wrong root" ? mapping("123", "NQU6") : problem === "out of range" ? mapping("123", "ESU6", "2026-09-02", "2026-09-03") : Response.json({ result: { "123": [{ d0: "2026-09-01", d1: "2026-09-02", s: "ESU6" }, { d0: "2026-09-01", d1: "2026-09-02", s: "ESZ6" }] } });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(header + row())).mockResolvedValueOnce(response);
    await expect(consume(new DatabentoProvider("mock-key", fetcher))).rejects.toThrow();
  });
  it("does not resolve or invent bars for a normal empty download", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(header));
    expect(await consume(new DatabentoProvider("mock-key", fetcher))).toEqual([]); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("classifies an unavailable recent range as a licensing issue with the allowed UTC cutoff", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: { case: "dataset_unavailable_range", message: "api_key=do-not-expose", payload: { available_end: "2026-10-12T23:14:00Z" } } }, { status: 422 }));
    const source = new DatabentoProvider("mock-key", fetcher);
    const error = await consume(source).catch((value) => value);
    expect(error).toMatchObject({ status: 422, code: "AUTH", provider: { method: "timeseries.get_range", case: "dataset_unavailable_range" } });
    expect(error.message).toContain("2026-10-12T23:14:00.000Z"); expect(error.message).toContain("订阅或许可");
    expect(error.message).not.toMatch(/api_key|do-not-expose/); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains a safe error case and HTTP status without exposing echoed provider payloads", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: { case: "symbology_invalid_request", message: "secret api_key=mock-key", payload: { authorization: "mock-key" } } }, { status: 422 }));
    const error = await consume(new DatabentoProvider("mock-key", fetcher)).catch((value) => value);
    expect(error.message).toMatch(/HTTP 422.*symbology_invalid_request/); expect(error.message).not.toMatch(/secret|api_key|mock-key/);
    expect(error.provider).toEqual({ method: "timeseries.get_range", case: "symbology_invalid_request" });
  });
  it("distinguishes payment failures and discards oversized error bodies", async () => {
    const payment = vi.fn().mockResolvedValue(Response.json({ detail: { case: "payment_required" } }, { status: 402 }));
    await expect(consume(new DatabentoProvider("mock-key", payment))).rejects.toThrow(/付款/);
    const huge = vi.fn().mockResolvedValue(new Response("mock-key".repeat(3000), { status: 422 }));
    const error = await consume(new DatabentoProvider("mock-key", huge)).catch((value) => value);
    expect(error.message).not.toContain("mock-key"); expect(error.provider.case).toBeNull();
  });
  it("honors Retry-After for metadata without retrying authentication errors", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("secret must never surface", { status: 429, headers: { "retry-after": "0" } })).mockResolvedValueOnce(Response.json(0.25));
    expect(await new DatabentoProvider("mock-key", fetcher).cost(profile, new Date(0), new Date(60000), signal())).toBe(0.25); expect(fetcher).toHaveBeenCalledTimes(2);
    const denied = vi.fn().mockResolvedValue(new Response("api_key=do-not-expose", { status: 403 }));
    await expect(new DatabentoProvider("mock-key", denied).cost(profile, new Date(0), new Date(60000), signal())).rejects.not.toThrow(/api_key/); expect(denied).toHaveBeenCalledTimes(1);
  });
});
