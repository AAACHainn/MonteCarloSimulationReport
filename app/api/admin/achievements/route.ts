import { achievementJson, cursorInput } from "@/lib/achievements/http";
import { readAchievementMaintenance } from "@/lib/achievements/read";

export async function GET(request: Request) {
  return achievementJson(() => readAchievementMaintenance(cursorInput.parse(Object.fromEntries(new URL(request.url).searchParams)).after));
}
