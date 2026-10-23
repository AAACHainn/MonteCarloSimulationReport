import { Breadcrumbs } from "@/components/breadcrumbs";
import { PropTemplateManager } from "@/components/market-replay/prop-template-manager";
import { copy } from "@/lib/i18n";
export const dynamic = "force-dynamic";
export default function PropTemplatesPage() {
  return <div className="space-y-6"><Breadcrumbs items={[{ label: copy.marketReplay.title, href: "/market-replay" }, { label: copy.propPractice.templates }]} />
    <section className="border-b pb-6"><h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.propPractice.templates}</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">{copy.propPractice.description}</p></section><PropTemplateManager /></div>;
}
