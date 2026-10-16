import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: dirname(createRequire(import.meta.url).resolve("eslint-config-next/package.json")),
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "tmp/**", "node_modules/**", ".pnpm-store/**", "next-env.d.ts"],
  },
  {
    files: ["app/**/*.{js,jsx,ts,tsx}", "components/**/*.{js,jsx,ts,tsx}", "lib/**/*.{js,jsx,ts,tsx}"],
    ignores: ["lib/uuid.ts", "app/api/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-properties": ["error", {
        property: "randomUUID",
        message: "普通 HTTP 不保证支持 crypto.randomUUID()。浏览器及共享代码统一使用 @/lib/uuid 的 createUuid()；纯服务端使用 node:crypto 的 randomUUID 命名导入。",
      }],
    },
  },
];

export default eslintConfig;
