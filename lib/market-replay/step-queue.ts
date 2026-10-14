/** Serializes manual steps without dropping rapid clicks; active work can cooperatively observe cancellation. */
export function createReplayStepQueue() {
  let generation = 0;
  let tail = Promise.resolve();
  return {
    enqueue(step: (isCancelled: () => boolean) => Promise<void>, canStart: () => boolean = () => true) {
      const queuedGeneration = generation;
      const operation = tail.then(async () => {
        // Key release only skips waiting repeats. Once started, a display candle
        // finishes normally; reset/view changes can still cancel active work.
        if (queuedGeneration === generation && canStart()) {
          await step(() => queuedGeneration !== generation);
        }
      });
      tail = operation.catch(() => { generation += 1; });
      return tail;
    },
    cancel() { generation += 1; },
  };
}
