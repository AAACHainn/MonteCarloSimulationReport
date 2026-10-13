export function createDeterministicEventIdFactory(
  sessionId: string,
  generation: number,
  sourceSequence: number,
) {
  let ordinal = 0;
  return (cause?: string) => `replay_${sessionId}_${generation}_${sourceSequence}_${cause === undefined ? ordinal++ : encodeURIComponent(cause)}`;
}
