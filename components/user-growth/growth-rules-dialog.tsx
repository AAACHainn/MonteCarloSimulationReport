"use client";

import { useId, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";
import { FOUNDATION_REQUIREMENTS, GROWTH_XP, QI_THRESHOLDS } from "@/lib/user-growth/rules";
import type { GrowthProfile } from "@/lib/user-growth/types";
import { cn } from "@/lib/utils";

const t = copy.userGrowth, guide = t.guide;
export type GrowthRulesTab = "experience" | "realms";
const tabs: GrowthRulesTab[] = ["experience", "realms"];
const rewardKeys = ["CYCLE", "REVIEW", "EVALUATION", "PAYOUT_FIRST"] as const;
type CurrentRealm = Pick<GrowthProfile, "realm" | "layer">;

/** Read existing rule constants; this view never awards experience or changes thresholds. */
export function GrowthRulesBody({ tab, onTabChange, current }: { tab: GrowthRulesTab; onTabChange: (tab: GrowthRulesTab) => void; current?: CurrentRealm }) {
  const id = useId(), tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const levels = [
    { label: t.mortal, realm: "mortal", layer: 0, threshold: 0, increment: null },
    ...QI_THRESHOLDS.map((threshold, i) => ({ label: t.qiLayer(t.layerNames[i]), realm: "qi", layer: i + 1, threshold, increment: threshold - (QI_THRESHOLDS[i - 1] ?? 0) })),
    { label: t.foundationOne, realm: "foundation", layer: 1, threshold: FOUNDATION_REQUIREMENTS.totalXp, increment: FOUNDATION_REQUIREMENTS.totalXp - QI_THRESHOLDS[QI_THRESHOLDS.length - 1] },
  ];
  return <div className="space-y-4">
    <div role="tablist" aria-label={guide.title} className="flex gap-2 border-b pb-2">
      {tabs.map((key, index) => <Button key={key} ref={element => { tabRefs.current[index] = element; }} type="button" role="tab" id={`${id}-tab-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel-${key}`} tabIndex={tab === key ? 0 : -1} data-dialog-initial-focus={tab === key ? "" : undefined} variant="ghost" className={cn(tab === key && "bg-blue-50 text-blue-700")} onClick={() => onTabChange(key)} onKeyDown={event => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null;
        if (next === null) return;
        event.preventDefault(); onTabChange(tabs[next]); tabRefs.current[next]?.focus();
      }}>{guide[key]}</Button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0} className="space-y-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {tab === "experience" ? <>
        <Table aria-label={guide.experience}><TableHeader><TableRow><TableHead>{guide.activity}</TableHead><TableHead className="whitespace-nowrap text-right">{guide.reward}</TableHead><TableHead>{guide.limits}</TableHead></TableRow></TableHeader><TableBody>
          {rewardKeys.map(key => <TableRow key={key}><TableCell className="min-w-32 font-medium text-slate-950">{guide.rewards[key].title}</TableCell><TableCell className="whitespace-nowrap text-right font-mono tabular-nums text-emerald-700">+{formatInteger(GROWTH_XP[key])}</TableCell><TableCell className="min-w-56 leading-6 text-slate-600">{guide.rewards[key].detail}</TableCell></TableRow>)}
        </TableBody></Table>
        <section className="space-y-2 border-t pt-4"><h3 className="text-sm font-semibold text-slate-950">{guide.notesTitle}</h3><ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">{guide.notes.map(note => <li key={note}>{note}</li>)}</ul></section>
      </> : <>
        <p className="text-sm leading-6 text-slate-600">{guide.thresholdHint}</p>
        <Table aria-label={guide.realms}><TableHeader><TableRow><TableHead>{guide.realm}</TableHead><TableHead className="text-right">{guide.cumulative}</TableHead><TableHead className="text-right">{guide.increment}</TableHead></TableRow></TableHeader><TableBody>
          {levels.map(level => {
            const active = current?.realm === level.realm && (level.realm !== "qi" || current.layer === level.layer);
            return <TableRow key={level.label} aria-current={active ? "step" : undefined} className={cn(active && "bg-blue-50 hover:bg-blue-50")}><TableCell className="py-2 font-medium text-slate-950"><div className="flex flex-wrap items-center gap-2">{level.label}{active && <Badge className="border-blue-200 bg-white text-blue-700">{guide.current}</Badge>}</div></TableCell><TableCell className="py-2 text-right tabular-nums">{formatInteger(level.threshold)}</TableCell><TableCell className="py-2 text-right tabular-nums">{level.increment === null ? copy.common.dash : formatInteger(level.increment)}</TableCell></TableRow>;
          })}
        </TableBody></Table>
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">{guide.foundationHint(formatInteger(FOUNDATION_REQUIREMENTS.totalXp))}</p>
      </>}
    </div>
  </div>;
}

export function GrowthRulesDialog({ tab, onTabChange, current, onClose }: { tab: GrowthRulesTab | null; onTabChange: (tab: GrowthRulesTab) => void; current?: CurrentRealm; onClose: () => void }) {
  return <Dialog open={tab !== null} title={guide.title} description={guide.description} onClose={onClose}><GrowthRulesBody tab={tab ?? "experience"} onTabChange={onTabChange} current={current} /></Dialog>;
}
