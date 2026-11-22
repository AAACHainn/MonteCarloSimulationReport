import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/lib/i18n";

export default function AdminPage() {
  const t = copy.achievements.admin;
  return <div className="space-y-6">
    <Breadcrumbs items={[{ label: t.title }]} />
    <section className="border-b pb-6"><h1 className="text-3xl font-semibold tracking-tight text-foreground">{t.title}</h1></section>
    <Card>
      <CardHeader><CardTitle>{t.achievements}</CardTitle><CardDescription>{t.summary}</CardDescription></CardHeader>
      <CardContent><Button asChild><Link href="/admin/achievements">{t.achievements}</Link></Button></CardContent>
    </Card>
  </div>;
}
