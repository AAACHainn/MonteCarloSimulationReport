export function createDeterministicEventIdFactory(
  sessionId: string,
  generation: number,
  sourceSequence: number,
) {
  let ordinal = 0;
  return () => `replay_${sessionId}_${generation}_${sourceSequence}_${ordinal++}`;
}
