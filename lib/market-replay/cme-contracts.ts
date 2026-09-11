const FUTURES_MONTH_CODES = new Set("FGHJKMNQUVXZ".split(""));

export type CmeDailyVolumes = Map<string, Map<string, number>>;

export function cmeVolumeDateKey(timestamp: Date) {
  return timestamp.toISOString().slice(0, 10);
}

/** Returns one normalized outright symbol and rejects spreads, options, and other roots. */
export function normalizeCmeOutrightSymbol(symbol: string | undefined, rootSymbol: string) {
  if (!symbol) return null;
  const normalizedRoot = rootSymbol.trim().toUpperCase();
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedRoot || !normalizedSymbol.startsWith(normalizedRoot)) return null;
  const suffix = normalizedSymbol.slice(normalizedRoot.length);
  const match = /^([A-Z])(\d{1,2})$/.exec(suffix);
  return match && FUTURES_MONTH_CODES.has(match[1]) ? normalizedSymbol : null;
}

export function addCmeDailyVolume(
  dailyVolumes: CmeDailyVolumes,
  timestamp: Date,
  symbol: string,
  volume: number,
) {
  const date = cmeVolumeDateKey(timestamp);
  let volumes = dailyVolumes.get(date);
  if (!volumes) {
    volumes = new Map();
    dailyVolumes.set(date, volumes);
  }
  volumes.set(symbol, (volumes.get(symbol) ?? 0) + volume);
}

function highestVolumeSymbol(volumes: Map<string, number>) {
  let bestSymbol: string | null = null;
  let bestVolume = Number.NEGATIVE_INFINITY;
  for (const [symbol, volume] of volumes) {
    if (volume > bestVolume || (volume === bestVolume && (bestSymbol === null || symbol < bestSymbol))) {
      bestSymbol = symbol;
      bestVolume = volume;
    }
  }
  return bestSymbol;
}

/**
 * Mirrors Databento's volume continuous rule: today's contract is ranked using
 * the previous available UTC day's volume. The first date (or an expired prior
 * leader) falls back to the current date's most active outright.
 */
export function buildCmeVolumeLeadMap(dailyVolumes: CmeDailyVolumes) {
  const result = new Map<string, string>();
  let previousLeader: string | null = null;
  for (const date of [...dailyVolumes.keys()].sort()) {
    const currentVolumes = dailyVolumes.get(date)!;
    const currentLeader = highestVolumeSymbol(currentVolumes);
    if (!currentLeader) continue;
    const selected = previousLeader && currentVolumes.has(previousLeader) ? previousLeader : currentLeader;
    result.set(date, selected);
    previousLeader = currentLeader;
  }
  return result;
}
