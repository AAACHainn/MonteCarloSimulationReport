export async function register() {
  if (process.env.USER_GROWTH_PREVIEW === "1" || process.env.USER_GROWTH_ACCEPTANCE === "1") return;
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build" && !process.env.VITEST) {
    const { startMarketSyncRuntime } = await import("./lib/market-sync/runtime");
    startMarketSyncRuntime();
    const { startAggregationRuntime } = await import("./lib/market-replay/aggregation-runtime");
    startAggregationRuntime();
  }
}
