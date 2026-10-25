import { UserProfilePage } from "@/components/user-growth/profile-pages";
export default async function Page({ params }: { params: Promise<{ userId: string }> }) { return <UserProfilePage key={(await params).userId} userId={(await params).userId} />; }
