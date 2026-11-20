import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    cache: false,
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
