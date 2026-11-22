import { z } from "zod";
import { achievementKeys } from "@/lib/achievements/catalog";
import { achievementJson, pathId } from "@/lib/achievements/http";
import { readAchievementDetail } from "@/lib/achievements/read";

const routeInput = z.object({ userId: pathId, key: z.enum(achievementKeys) }).strict();
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string; key: string }> }) {
  return achievementJson(async () => {
    const { userId, key } = routeInput.parse(await params);
    return readAchievementDetail(userId, key);
  });
}
