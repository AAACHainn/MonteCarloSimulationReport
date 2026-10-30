/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is required by the isolated Node --require preload. */
// Only explicitly launched validation processes load this file. The application never imports it.
const { createRequire } = require("node:module");
const path = require("node:path");
const { root, validationClientClass } = require("./client.cjs");
const rootRequire = createRequire(path.join(root, "package.json"));
if (rootRequire("@prisma/client/package.json").version !== "6.19.3") throw new Error("Validation requires the locked Prisma 6.19.3 client");
const clientModule = rootRequire("@prisma/client");
const applicationFactory = process.env.SQLITE_WAL_USE_APPLICATION_DRIVER === "1"
  ? rootRequire(path.join(root, "lib/sqlite-client.mjs")).createDatabaseClient : undefined;
clientModule.PrismaClient = validationClientClass(clientModule.PrismaClient, process.env.SQLITE_WAL_VALIDATION_MODE, applicationFactory);
