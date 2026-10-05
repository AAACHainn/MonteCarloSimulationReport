import type { z } from "zod";
import type { marketDatasetSchema } from "@/lib/validations";

export type AppendSnapshot = {
  barCount: number;
  endTime: string;
  dataVersion: number;
};
export type AppendGap = { after: string; before: string; missingBars: number };
export type AppendPreview = {
  importedBars: number;
  overlappingRows: number;
  duplicateRows: number;
  skippedRows: number;
  gapCount: number;
  missingBars: number;
  gaps: AppendGap[];
  firstTime: string | null;
  lastTime: string | null;
};
export type AppendImportMetadata = z.infer<typeof marketDatasetSchema> & {
  mode: "APPEND";
  targetDatasetId: string;
  snapshot?: AppendSnapshot;
  preview?: AppendPreview;
  confirmed?: boolean;
};
