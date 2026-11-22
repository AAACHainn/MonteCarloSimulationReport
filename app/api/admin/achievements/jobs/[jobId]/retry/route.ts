import { z } from "zod";
import { achievementJson, parseAchievementRequest, pathId } from "@/lib/achievements/http";
import { retryAchievementJob } from "@/lib/achievements/jobs";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return achievementJson(async () => {
    await parseAchievementRequest(request, z.object({}).strict());
    return retryAchievementJob(pathId.parse((await params).jobId));
  });
}
