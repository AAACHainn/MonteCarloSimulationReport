import { afterEach, expect, it, vi } from "vitest";

const businessRuntime = vi.hoisted(() => ({ sync: vi.fn(), aggregation: vi.fn() }));
vi.mock("./lib/market-sync/runtime", () => ({ startMarketSyncRuntime: businessRuntime.sync }));
vi.mock("./lib/market-replay/aggregation-runtime", () => ({ startAggregationRuntime: businessRuntime.aggregation }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("does not start business runtimes in the isolated growth preview", async () => {
  vi.stubEnv("USER_GROWTH_PREVIEW", "1");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("VITEST", "");
  const { register } = await import("./instrumentation");
  await register();
  expect(businessRuntime.sync).not.toHaveBeenCalled();
  expect(businessRuntime.aggregation).not.toHaveBeenCalled();
});
it("does not start sync or aggregation workers in the isolated database acceptance instance", async () => {
  vi.stubEnv("USER_GROWTH_PREVIEW", "");
  vi.stubEnv("USER_GROWTH_ACCEPTANCE", "1");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("VITEST", "");
  const { register } = await import("./instrumentation");
  await register();
  expect(businessRuntime.sync).not.toHaveBeenCalled();
  expect(businessRuntime.aggregation).not.toHaveBeenCalled();
});
