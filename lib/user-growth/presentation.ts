import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";
import { growthRealm, growthSegment, type GrowthRealm } from "./rules";
import type { GrowthProgress } from "./types";
export function realmLabel(realm: GrowthRealm["realm"], layer: number) {
  return realm === "FOUNDATION" ? copy.userGrowth.foundationOne : realm === "QI" ? copy.userGrowth.qiLayer(copy.userGrowth.layerNames[layer - 1]) : copy.userGrowth.mortal;
}
export function growthProgress(totalXp: number, foundation = false): GrowthProgress {
  const current = growthRealm(totalXp, foundation), segment = growthSegment(totalXp, foundation);
  return { totalXp, realm: current.realm === "MORTAL" ? "mortal" : current.realm === "QI" ? "qi" : "foundation",
    segment: segment ? { value: segment.value, max: segment.max, next: segment.nextLayer > 12 ? copy.userGrowth.foundationOne : realmLabel("QI", segment.nextLayer) } : undefined };
}
export type SessionGrowthView = { userId: string; nickname: string; totalXp: number; realmLabel: string; version: number };
export function settledGrowthNotice(before: SessionGrowthView | null | undefined, after: SessionGrowthView | null | undefined) {
  if (!before || !after || before.userId !== after.userId || after.version <= before.version || after.totalXp <= before.totalXp) return null;
  return copy.userGrowth.settledNotice(after.nickname, formatInteger(after.totalXp - before.totalXp), before.realmLabel !== after.realmLabel ? after.realmLabel : "");
}
