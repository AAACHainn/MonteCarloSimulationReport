export const IMPORT_STAGES = [
  "WAITING_UPLOAD", "UPLOADING", "CLEANING", "ANALYZING", "IMPORTING", "FINALIZING", "COMPLETED",
] as const;

export type MarketImportStage = typeof IMPORT_STAGES[number];
export type ImportEtaScope = "STAGE" | "OVERALL" | null;

type ImportProgressInput = {
  status: string;
  stage: string;
  stageProcessedBytes: bigint | number;
  stageTotalBytes: bigint | number;
  stageStartedAt: Date | string | null;
};

const stageBands: Partial<Record<MarketImportStage, readonly [number, number]>> = {
  WAITING_UPLOAD: [0, 0],
  UPLOADING: [0, 10],
  CLEANING: [10, 10],
  ANALYZING: [10, 35],
  IMPORTING: [35, 99],
  FINALIZING: [99, 99],
  COMPLETED: [100, 100],
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateImportProgress(input: ImportProgressInput, now = Date.now()) {
  if (input.status === "COMPLETED") {
    return { progressPercent: 100, estimatedRemainingSeconds: 0, etaScope: null as ImportEtaScope };
  }
  const stage = IMPORT_STAGES.includes(input.stage as MarketImportStage)
    ? input.stage as MarketImportStage
    : "WAITING_UPLOAD";
  const [start, end] = stageBands[stage] ?? [0, 0];
  const processed = Math.max(0, Number(input.stageProcessedBytes));
  const total = Math.max(0, Number(input.stageTotalBytes));
  const fraction = total > 0 ? clamp(processed / total, 0, 1) : 0;
  const progressPercent = Math.round((start + (end - start) * fraction) * 10) / 10;
  const startedAt = input.stageStartedAt ? new Date(input.stageStartedAt).getTime() : Number.NaN;
  const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, (now - startedAt) / 1_000) : 0;
  const canEstimate = total > 0 && processed > 0 && fraction >= 0.01 && elapsedSeconds >= 5;
  const remaining = canEstimate
    ? Math.max(0, Math.ceil((total - processed) / (processed / elapsedSeconds)))
    : null;
  const etaScope: ImportEtaScope = remaining === null
    ? null
    : stage === "IMPORTING" ? "OVERALL" : "STAGE";
  return { progressPercent, estimatedRemainingSeconds: remaining, etaScope };
}
