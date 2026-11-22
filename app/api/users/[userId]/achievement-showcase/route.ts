import { achievementJson, parseAchievementRequest, pathId } from "@/lib/achievements/http";
import { saveShowcase, showcaseInput } from "@/lib/achievements/read";

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  return achievementJson(async () => {
    const { series } = await parseAchievementRequest(request, showcaseInput);
    return { series: await saveShowcase(pathId.parse((await params).userId), series) };
  });
}
