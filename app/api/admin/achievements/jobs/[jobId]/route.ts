import { achievementJson, cursorInput, pathId } from "@/lib/achievements/http";
import { readAchievementJob } from "@/lib/achievements/read";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return achievementJson(async () => readAchievementJob(pathId.parse((await params).jobId), cursorInput.parse(Object.fromEntries(new URL(request.url).searchParams)).after));
}
