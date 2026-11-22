import { randomUUID } from "node:crypto";
import { constants, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    sqliteFixtureTemplate: string;
  }
}

export function createSqliteFixture(prefix: string, directory = tmpdir()) {
  const file = join(directory, `${prefix}-${randomUUID()}.db`);
  mkdirSync(directory, { recursive: true });
  copyFileSync(inject("sqliteFixtureTemplate"), file, constants.COPYFILE_EXCL);
  return file;
}
