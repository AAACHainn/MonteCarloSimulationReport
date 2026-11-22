import { configDefaults, defineWorkspace } from "vitest/config";

const sqliteFixtureSuites = [
  "lib/{achievements,ai,market-replay,market-sync,prop-practice,replay-sessions,user-growth,user-wallet}/**/*.integration.test.ts",
  "scripts/database/review-limit-migration.integration.test.ts",
  "scripts/database/sqlite-test-fixture.integration.test.ts",
];

export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: {
      name: "default",
      exclude: [...configDefaults.exclude, "tmp/**", ...sqliteFixtureSuites],
    },
  },
  {
    extends: "./vitest.config.ts",
    test: {
      name: "sqlite-fixtures",
      include: sqliteFixtureSuites,
      globalSetup: "./scripts/database/sqlite-test-setup.mjs",
    },
  },
]);
