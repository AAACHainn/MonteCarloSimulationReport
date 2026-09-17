export type ReplayPauseReason =
  | "user"
  | "page-hidden"
  | "operation"
  | "operation-failed"
  | "source-failed"
  | "sync-conflict"
  | "state-mismatch"
  | "finished";

export type ReplaySuspension = {
  intent: number;
  wasPlaying: boolean;
};

/** Tracks who owns permission to resume after a temporary operation. */
export function createPlaybackIntentTracker() {
  let intent = 0;
  return {
    current: () => intent,
    invalidate: () => { intent += 1; return intent; },
    suspend: (wasPlaying: boolean): ReplaySuspension => ({ intent, wasPlaying }),
    mayResume: (suspension: ReplaySuspension) => suspension.wasPlaying && suspension.intent === intent,
  };
}

export async function retryReplayRead<T>(
  operation: (attempt: number) => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  delays: readonly number[] = [150, 400],
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}
