import { z } from "zod";
import { achievementJson, pathId } from "@/lib/achievements/http";
import { readAchievementNotifications } from "@/lib/achievements/read";

const queryInput = z.object({ after: z.coerce.number().int().min(0).max(2_147_483_647).optional() }).strict();
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  return achievementJson(async () => {
    const { after } = queryInput.parse(Object.fromEntries(new URL(request.url).searchParams));
    return readAchievementNotifications(pathId.parse((await params).userId), after);
  });
}
