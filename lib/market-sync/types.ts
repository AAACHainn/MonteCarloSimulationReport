import { z } from "zod";

export const NATIVE_INTERVALS = [1, 60, 3600, 86400] as const;
export const profileSchema = z.object({
  root: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,16}$/),
  contractMode: z.enum(["CONTINUOUS", "OUTRIGHT"]),
  contract: z.string().trim().toUpperCase().max(32).default(""),
  interval: z.number().refine((value) => NATIVE_INTERVALS.includes(value as typeof NATIVE_INTERVALS[number])),
}).superRefine((value, ctx) => {
  if (value.contractMode === "OUTRIGHT" && !new RegExp(`^${value.root}[FGHJKMNQUVXZ]\\d{1,2}$`).test(value.contract)) {
    ctx.addIssue({ code: "custom", path: ["contract"], message: "Invalid outright contract" });
  }
});
export const scheduleSchema = z.object({
  unit: z.enum(["MINUTE", "HOUR", "DAY", "WEEK", "MONTH"]),
  every: z.number().int().min(1).max(1000),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  weekday: z.number().int().min(0).max(6),
  monthDay: z.number().int().min(1).max(31),
  monthEnd: z.boolean(),
  anchor: z.string().datetime(),
});
export const syncConfigSchema = z.object({
  mode: z.enum(["OFF", "MANUAL", "AUTO"]),
  profile: profileSchema,
  schedule: scheduleSchema,
  perRunBudget: z.number().finite().min(0).max(100000),
  dailyBudget: z.number().finite().min(0).max(100000),
});
export type SyncProfile = z.infer<typeof profileSchema>;
export type SyncSchedule = z.infer<typeof scheduleSchema>;
export type SyncSettings = z.infer<typeof syncConfigSchema>;
export type SyncBar = { timestamp: Date; open: number; high: number; low: number; close: number; volume: number | null; symbol: string };
export type Charge = { at: string; cost: number };
export const defaultSchedule = (): SyncSchedule => ({ unit: "DAY", every: 1, time: "09:00", timezone: "Asia/Shanghai", weekday: 1, monthDay: 1, monthEnd: false, anchor: new Date().toISOString() });
export type SyncRunView = { id: string; status: string; stage: string; addedBars: number; estimatedCost: number; error: string | null; conflicts: string; updatedAt: string };
export type SyncConfigView = SyncSettings & { nextRunAt: string | null; lastCheckedAt: string | null; pausedReason: string | null; availableThrough: string | null; active: boolean; latestRun: SyncRunView | null };
