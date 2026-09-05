/** Serializes manual steps without dropping rapid clicks; cancel discards only queued work. */
export function createReplayStepQueue() {
  let generation = 0;
  let tail = Promise.resolve();
  return {
    enqueue(step: () => Promise<void>) {
      const queuedGeneration = generation;
      const operation = tail.then(async () => {
        if (queuedGeneration === generation) await step();
      });
      tail = operation.catch(() => { generation += 1; });
      return tail;
    },
    cancel() { generation += 1; },
  };
}
