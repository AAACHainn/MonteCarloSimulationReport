import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/adapter-better-sqlite3", "better-sqlite3"],
};

export default nextConfig;
