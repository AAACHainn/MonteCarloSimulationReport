import type { ReplayProgressData } from "@/lib/market-replay/types";

export type ReplaySessionMode = "TRAINING" | "LIVE_REPLAY";
export type ReplaySessionSummary = {
  id: string;
  datasetId: string;
  name: string;
  mode: ReplaySessionMode;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  activeProjectionId: string;
  pendingCorrectionId: string | null;
  legacy: boolean;
  riskPreferences: import("@/lib/paper-trading/risk-preferences").RiskPreferencesInput;
  progress: ReplayProgressData | null;
  entryCount: number;
  createdAt: string;
  updatedAt: string;
  accountCategory?: string;
  propAccount?: { snapshot: import("@/lib/prop-practice/service").PropSnapshot; state: import("@/lib/prop-practice/rules").PropState } | null;
};

export type CorrectionMetrics = { currency: string; balance: number; netQuantity: number; realizedPnl: number; totalFees: number; totalSlippage: number; peakEquity: number; maxDrawdown: number; tradeCount: number };
export type CorrectionSummary = {
  before?: CorrectionMetrics | null; after?: CorrectionMetrics | null;
  beforeEntries?: number; afterEntries?: number; removedCommands?: number;
  fallbackTargetSequence?: number; originalSequence?: number; targetSequence?: number; maxSourceChunk?: number;
};
export type CorrectionJobData = {
  id: string; type: "REWIND" | "DELETE_CYCLE"; status: "QUEUED" | "RUNNING" | "READY" | "APPLIED" | "CANCELLED" | "FAILED" | "INTERRUPTED";
  targetSequence: number; cycleKey: string | null; processedSourceBars: number; totalSourceBars: number;
  summary: CorrectionSummary; error: string | null;
};
