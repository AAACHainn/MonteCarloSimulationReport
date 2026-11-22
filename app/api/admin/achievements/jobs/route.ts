import { achievementJson, parseAchievementRequest } from "@/lib/achievements/http";
import { jobInput, startAchievementJob } from "@/lib/achievements/jobs";

export async function POST(request: Request) {
  return achievementJson(async () => startAchievementJob((await parseAchievementRequest(request, jobInput)).planId));
}
