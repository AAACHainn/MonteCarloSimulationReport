/** Presentation inputs only. No persistence or reward settlement is performed by these views. */
export type AvatarValue = { preset: number; src?: string; zoom: number; x: number; y: number };
export type GrowthProgress = { realm: "mortal" | "qi" | "foundation"; totalXp: number; segment?: { value: number; max: number; next: string } };
export type UserIdentity = { id: string; nickname: string; avatar: AvatarValue; realmLabel: string; growth?: GrowthProgress };
export type GrowthRecord = { id: string; title: string; xp: number; detail: string; settledAt: string; replayAt: string; source: string; deleted?: boolean; sourceUrl?: string; ruleVersion?: string };
export type GrowthRecordPage = { items: GrowthRecord[]; page: number; pageSize: number; total: number; snapshot?: number };
export type ProfileSession = { id: string; datasetId?: string; name: string; market: string; mode: "training" | "replay"; account: "default" | "prop"; trades: number; created: string; eligibility: "growth" | "replay" | "unassigned" };
export type GrowthProfile = {
  user: UserIdentity;
  realm: "mortal" | "qi" | "foundation";
  layer: number;
  totalXp: number;
  growthPending?: boolean;
  attainedAt?: string;
  segment?: { value: number; max: number; next: string };
  conditions: { value: number; target: number }[];
  records: GrowthRecord[];
  recordCount: number;
  sessions: ProfileSession[];
};
export type QueryState = "normal" | "loading" | "error";
