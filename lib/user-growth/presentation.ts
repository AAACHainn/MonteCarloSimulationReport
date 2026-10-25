import { copy } from "@/lib/i18n";
import { formatInteger } from "@/lib/format";
import type { GrowthRealm } from "./rules";
export function realmLabel(realm: GrowthRealm["realm"], layer: number) {
  return realm === "FOUNDATION" ? copy.userGrowth.foundationOne : realm === "QI" ? copy.userGrowth.qiLayer(copy.userGrowth.layerNames[layer - 1]) : copy.userGrowth.mortal;
}
export type SessionGrowthView = { userId: string; nickname: string; totalXp: number; realmLabel: string; version: number };
export function settledGrowthNotice(before: SessionGrowthView | null | undefined, after: SessionGrowthView | null | undefined) {
  if (!before || !after || before.userId !== after.userId || after.version <= before.version || after.totalXp <= before.totalXp) return null;
  return copy.userGrowth.settledNotice(after.nickname, formatInteger(after.totalXp - before.totalXp), before.realmLabel !== after.realmLabel ? after.realmLabel : "");
}
