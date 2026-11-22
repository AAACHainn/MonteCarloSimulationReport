import { AchievementCollection } from "@/components/achievements/collection";

export default async function Page({ params, searchParams }: {
  params: Promise<{ userId: string }>; searchParams: Promise<{ session?: string }>;
}) {
  const { userId } = await params;
  const { session } = await searchParams;
  return <AchievementCollection key={userId} userId={userId} focusSession={typeof session === "string" ? session : undefined} />;
}
