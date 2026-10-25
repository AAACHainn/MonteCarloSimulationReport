/** Presentation inputs only. No persistence or reward settlement is performed by these views. */
export type AvatarValue = { preset: number; src?: string; zoom: number; x: number; y: number };
export type UserIdentity = { id: string; nickname: string; avatar: AvatarValue; realmLabel: string };
export type GrowthRecord = { id: string; title: string; xp: number; detail: string; settledAt: string; replayAt: string; source: string; deleted?: boolean };
export type GrowthRecordPage = { items: GrowthRecord[]; page: number; pageSize: number; total: number };
export type ProfileSession = { id: string; name: string; market: string; mode: "training" | "replay"; account: "default" | "prop"; trades: number; created: string; eligibility: "growth" | "historical" | "replay" };
export type GrowthProfile = {
  user: UserIdentity;
  realm: "mortal" | "qi" | "foundation";
  layer: number;
  totalXp: number;
  attainedAt?: string;
  segment?: { value: number; max: number; next: string };
  conditions: { value: number; target: number }[];
  records: GrowthRecord[];
  recordCount: number;
  sessions: ProfileSession[];
};
export type QueryState = "normal" | "loading" | "error";
