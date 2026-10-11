import { isValidDisplayInterval } from "./types";

const DISPLAY_INTERVAL_PRESETS = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1_800, 2_700, 3_600, 7_200, 14_400, 21_600, 43_200, 86_400];

/** Include the source and current custom period alongside compatible presets. */
export function displayIntervalOptions(sourceSeconds: number | null, currentSeconds: number) {
  if (sourceSeconds === null) return [];
  return [...new Set([...DISPLAY_INTERVAL_PRESETS, sourceSeconds, currentSeconds])]
    .filter((seconds) => isValidDisplayInterval(sourceSeconds, seconds))
    .sort((left, right) => left - right);
}
