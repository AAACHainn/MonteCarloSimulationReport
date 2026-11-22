import { z } from "zod";
import { achievementJson, pathId } from "@/lib/achievements/http";
import { readAchievements } from "@/lib/achievements/read";

const queryInput = z.object({ session: pathId.optional() }).strict();
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  return achievementJson(async () => {
    const { session } = queryInput.parse(Object.fromEntries(new URL(request.url).searchParams));
    return readAchievements(pathId.parse((await params).userId), session);
  });
}
