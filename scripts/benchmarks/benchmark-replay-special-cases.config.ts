import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", cache: false, include: ["scripts/benchmarks/benchmark-replay-special-cases.ts"] }, resolve: { alias: { "@": new URL("../..", import.meta.url).pathname } } });
