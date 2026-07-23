import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeTagKey } from "./tags";

type TagDatabase = PrismaClient | Prisma.TransactionClient;

export async function resolveTradeTags(database: TagDatabase, names: string[]) {
  const tags = [];

  for (const name of names) {
    tags.push(
      await database.tradeTag.upsert({
        where: { normalizedName: normalizeTagKey(name) },
        update: {},
        create: {
          name,
          normalizedName: normalizeTagKey(name),
        },
      }),
    );
  }

  return tags.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}
