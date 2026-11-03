import { afterEach, describe, expect, it, vi } from "vitest";
import packageJson from "./package.json";
import nextConfig from "./next.config";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

afterEach(() => vi.unstubAllEnvs());

describe("Next output and bundler configuration", () => {
  it("keeps development output isolated and other phases on the production directory", () => {
    expect(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir).toBe(".next-dev");
    expect(nextConfig("phase-production-build").distDir).toBe(".next");
    expect(nextConfig("phase-production-server").distDir).toBe(".next");
  });

  it("keeps strict mode and native SQLite externals enabled", () => {
    const config = nextConfig(PHASE_DEVELOPMENT_SERVER);
    expect(config.reactStrictMode).toBe(true);
    expect(config.turbopack?.root).toBe(process.cwd());
    expect(config.serverExternalPackages).toEqual(["@prisma/adapter-better-sqlite3", "better-sqlite3"]);
  });

  it("uses each acceptance output suffix and the documented flag priority", () => {
    const cases = [
      ["USER_GROWTH_ACCEPTANCE", "user-growth-acceptance"],
      ["USER_GROWTH_ADVANCED_ACCEPTANCE", "user-growth-advanced"],
      ["USER_GROWTH_PREVIEW", "user-growth-preview"],
      ["USER_GROWTH_FINAL_ACCEPTANCE", "user-growth-final"],
    ] as const;

    for (const [flag, suffix] of cases) {
      vi.stubEnv(flag, "1");
      expect(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir).toBe(`.next-dev/${suffix}`);
      expect(nextConfig("phase-production-build").distDir).toBe(`.next/${suffix}`);
      vi.stubEnv(flag, "0");
    }

    for (const flag of ["USER_GROWTH_ACCEPTANCE", "USER_GROWTH_ADVANCED_ACCEPTANCE", "USER_GROWTH_PREVIEW", "USER_GROWTH_FINAL_ACCEPTANCE"]) {
      vi.stubEnv(flag, "1");
    }
    expect(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir).toBe(".next-dev/user-growth-final");
    expect(nextConfig("phase-production-build").distDir).toBe(".next/user-growth-final");
  });

  it("defaults dev/build to Turbopack, retains webpack fallbacks, and keeps next start", () => {
    expect(packageJson.scripts.dev).toBe("next dev --turbopack");
    expect(packageJson.scripts["dev:webpack"]).toBe("next dev");
    expect(packageJson.scripts.build).toBe("prisma generate && next build --turbopack");
    expect(packageJson.scripts["build:webpack"]).toBe("prisma generate && next build");
    expect(packageJson.scripts.start).toBe("next start");
  });
});
