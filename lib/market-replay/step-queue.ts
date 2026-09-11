/** Serializes manual steps without dropping rapid clicks; active work can cooperatively observe cancellation. */
export function createReplayStepQueue() {
  let generation = 0;
  let tail = Promise.resolve();
  return {
    enqueue(step: (isCancelled: () => boolean) => Promise<void>) {
      const queuedGeneration = generation;
      const operation = tail.then(async () => {
        if (queuedGeneration === generation) {
          await step(() => queuedGeneration !== generation);
        }
      });
      tail = operation.catch(() => { generation += 1; });
      return tail;
    },
    cancel() { generation += 1; },
  };
}
