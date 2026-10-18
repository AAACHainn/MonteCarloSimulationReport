import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", cache: false, include: ["scripts/sqlite-wal/benchmark.ts"] },
  resolve: { alias: { "@": new URL("../..", import.meta.url).pathname } },
});
