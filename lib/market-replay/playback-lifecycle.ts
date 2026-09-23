export type ReplayAutoPauseReason =
  | "page-hidden"
  | "operation-failed"
  | "source-failed"
  | "sync-conflict"
  | "state-mismatch";

export type ReplayPauseReason = "user" | "operation" | ReplayAutoPauseReason | "finished";

export type ReplayPlaybackIntent = {
  version: number;
};

export type ReplaySuspension = {
  id: number;
};

/** Separates user playback intent from one or more temporary operation blockers. */
export function createPlaybackIntentTracker() {
  let version = 0;
  let nextSuspensionId = 0;
  let wantsToPlay = false;
  const suspensions = new Set<number>();

  const current = (): ReplayPlaybackIntent => ({ version });

  return {
    current,
    isCurrent: (intent: ReplayPlaybackIntent) => intent.version === version,
    wantsToPlay: () => wantsToPlay,
    canPlay: () => wantsToPlay && suspensions.size === 0,
    play: () => {
      version += 1;
      wantsToPlay = true;
      return current();
    },
    pause: () => {
      version += 1;
      wantsToPlay = false;
      return current();
    },
    suspend: (): ReplaySuspension => {
      const suspension = { id: ++nextSuspensionId };
      suspensions.add(suspension.id);
      return suspension;
    },
    release: (suspension: ReplaySuspension) => {
      const released = suspensions.delete(suspension.id);
      return released && wantsToPlay && suspensions.size === 0;
    },
    hasSuspensions: () => suspensions.size > 0,
    finish: () => {
      version += 1;
      wantsToPlay = false;
      suspensions.clear();
      return current();
    },
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
