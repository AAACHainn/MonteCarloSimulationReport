/** Display metadata for the final model request, separate from answer/adoption data. */
export type ResponseDetails = {
  startedAt: string;
  durationMs: number;
  reasoning: string;
  reasoningMs: number | null;
};
