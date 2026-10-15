import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AiSettingsPanel } from "@/components/ai/settings-panel";
import { copy } from "@/lib/i18n";

export const metadata: Metadata = { title: copy.ai.settings };

export default function AiSettingsPage() {
  return <div className="space-y-6">
    <Breadcrumbs items={[{ label: copy.ai.settings }]} />
    <section className="border-b pb-6">
      <p className="font-mono text-sm uppercase tracking-wide text-blue-700">{copy.ai.settingsEyebrow}</p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.ai.settings}</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">{copy.ai.settingsDescription}</p>
    </section>
    <AiSettingsPanel />
  </div>;
}
