import { z } from "zod";
import { achievementJson, parseAchievementRequest } from "@/lib/achievements/http";
import { retryAchievementQueue } from "@/lib/achievements/jobs";

export async function POST(request: Request) {
  return achievementJson(async () => {
    await parseAchievementRequest(request, z.object({}).strict());
    return retryAchievementQueue();
  });
}
