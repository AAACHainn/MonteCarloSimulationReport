import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  const outputRoot = phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next";
  const acceptance = process.env.USER_GROWTH_FINAL_ACCEPTANCE === "1" ? "user-growth-final"
    : process.env.USER_GROWTH_PREVIEW === "1" ? "user-growth-preview"
    : process.env.USER_GROWTH_ADVANCED_ACCEPTANCE === "1" ? "user-growth-advanced"
    : process.env.USER_GROWTH_ACCEPTANCE === "1" ? "user-growth-acceptance" : null;

  return {
    reactStrictMode: true,
    turbopack: { root: __dirname },
    distDir: acceptance ? `${outputRoot}/${acceptance}` : outputRoot,
    serverExternalPackages: ["@prisma/adapter-better-sqlite3", "better-sqlite3"],
  };
}
