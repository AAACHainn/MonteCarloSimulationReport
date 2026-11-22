import { achievementJson, parseAchievementRequest } from "@/lib/achievements/http";
import { createAchievementPreview, previewInput } from "@/lib/achievements/jobs";

export async function POST(request: Request) {
  return achievementJson(async () => createAchievementPreview(await parseAchievementRequest(request, previewInput)));
}
