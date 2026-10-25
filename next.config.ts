import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.USER_GROWTH_PREVIEW === "1" ? ".next/user-growth-preview" : process.env.USER_GROWTH_ADVANCED_ACCEPTANCE === "1" ? ".next/user-growth-advanced" : process.env.USER_GROWTH_ACCEPTANCE === "1" ? ".next/user-growth-acceptance" : ".next",
  serverExternalPackages: ["@prisma/adapter-better-sqlite3", "better-sqlite3"],
};

export default nextConfig;
