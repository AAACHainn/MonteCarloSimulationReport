import { configDefaults, defineConfig } from "vitest/config";
import baseConfig from "../../vitest.config";

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["tests/legacy-migrations-v1/**/*.test.{ts,mjs}"],
    exclude: [...configDefaults.exclude],
  },
});
