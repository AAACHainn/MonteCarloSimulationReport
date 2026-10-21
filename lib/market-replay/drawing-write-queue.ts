const queues = new Map<string, Promise<void>>();

/** Serializes complete read/write/reconcile operations, including across editor remounts. */
export function runDrawingWrite<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(scope);
  const result = previous ? previous.then(operation) : operation();
  const tail = result.then(() => undefined, () => undefined);
  queues.set(scope, tail);
  void tail.then(() => { if (queues.get(scope) === tail) queues.delete(scope); });
  return result;
}
