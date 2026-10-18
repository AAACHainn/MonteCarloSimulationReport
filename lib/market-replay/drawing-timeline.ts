import { AggregationCalendar } from "./aggregation";
import type { ChartTimelineAnchor, ChartTimelineProjectionOptions } from "./chart-drawings";
import type { AggregatedMarketBarData } from "./types";

export type DrawingTimelineBar = Pick<AggregatedMarketBarData,
  "timestamp" | "bucketEnd" | "firstSequence" | "lastSequence"> & { expectedCount?: number };
type IndexedBar = { time: number; end: number; first: number; last: number; expected: number };
export const MAX_DRAWING_ANCHOR_CACHE = 4_096;

const metadataCache = new WeakMap<AggregatedMarketBarData, DrawingTimelineBar>();

/** Projection metadata deliberately carries no OHLC or volume. Immutable unchanged
 * candles reuse metadata so source-by-source replay only parses revised/new slots. */
export function drawingTimelineBars(bars: readonly AggregatedMarketBarData[]): DrawingTimelineBar[] {
  return bars.map((bar) => {
    let metadata = metadataCache.get(bar);
    if (!metadata) {
      const { timestamp, bucketEnd, firstSequence, lastSequence } = bar;
      metadata = { timestamp, bucketEnd, firstSequence, lastSequence };
      metadataCache.set(bar, metadata);
    }
    return metadata;
  });
}

function upperBound(bars: readonly IndexedBar[], target: number, key: "time" | "first") {
  let low = 0, high = bars.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (bars[mid][key] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V) {
  if (cache.size >= MAX_DRAWING_ANCHOR_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

/** One locator per chart, shared by both primitives and interactive previews.
 * Windows are immutable: replace their array on append, prepend, revision or crop.
 * The array identity (never its length) invalidates loaded-bar coordinates. Calendar
 * ordinals are data-independent and survive window changes, but not scope/config changes. */
export class DrawingTimelineLocator {
  private input: readonly DrawingTimelineBar[] | null = null;
  private readonly indexed = new WeakMap<DrawingTimelineBar, IndexedBar>();
  private bars: IndexedBar[] = [];
  private configuration = "";
  private scope = "";
  private interval = 1;
  private options: ChartTimelineProjectionOptions | undefined;
  private calendar: AggregationCalendar | null = null;
  private readonly anchors = new Map<string, number | null>();
  private readonly positions = new Map<string, number | null>();
  private readonly timestamps = new Map<number, number | null>();

  setTimeline(bars: readonly DrawingTimelineBar[], displayIntervalSeconds: number,
    options?: ChartTimelineProjectionOptions, scope = "") {
    const configuration = JSON.stringify([displayIntervalSeconds, options?.sourceIntervalSeconds,
      options?.session.mode, options?.session.timezone, options?.session.openMinute,
      options?.session.closeMinute, options?.session.weekdays]);
    const changed = configuration !== this.configuration || scope !== this.scope;
    if (!changed && this.input === bars) return;
    if (changed) {
      this.calendar = options ? new AggregationCalendar(displayIntervalSeconds, {
        ...options.session, weekdays: [...options.session.weekdays],
      }) : null;
      this.positions.clear();
    }
    this.configuration = configuration;
    this.scope = scope;
    this.input = bars;
    this.interval = Math.max(1, displayIntervalSeconds) * 1_000;
    this.options = options;
    this.bars = bars.map((bar) => {
      let indexed = this.indexed.get(bar);
      if (!indexed) {
        indexed = { time: Date.parse(bar.timestamp), end: Date.parse(bar.bucketEnd),
          first: bar.firstSequence, last: bar.lastSequence, expected: bar.expectedCount ?? 1 };
        this.indexed.set(bar, indexed);
      }
      return indexed;
    });
    this.anchors.clear();
    this.timestamps.clear();
  }

  private calendarPosition(time: number, direction: -1 | 1) {
    const key = time + ":" + direction;
    if (this.positions.has(key)) return this.positions.get(key)!;
    return remember(this.positions, key, this.calendar?.position(time, direction) ?? null);
  }

  logicalIndexForTimestamp(time: number): number | null {
    const bars = this.bars;
    if (!bars.length || !Number.isFinite(time)) return null;
    const index = upperBound(bars, time, "time") - 1;
    if (this.options && index >= 0 && time < bars[index].end) return index;
    if (index >= 0 && index < bars.length - 1) {
      return index + (time - bars[index].time) / (bars[index + 1].time - bars[index].time);
    }
    const referenceIndex = index < 0 ? 0 : bars.length - 1;
    const reference = bars[referenceIndex].time;
    if (time === reference) return referenceIndex;
    if (!this.calendar) return referenceIndex + (time - reference) / this.interval;
    const direction = time < reference ? -1 : 1;
    const origin = this.calendarPosition(reference, direction);
    const target = this.calendarPosition(time, direction);
    // A resource limit or invalid calendar is a failed projection, never a fallback
    // to elapsed wall time (which would silently count weekends and closed hours).
    return origin === null || target === null ? null : referenceIndex + target - origin;
  }

  logicalIndexForAnchor(anchor: ChartTimelineAnchor): number | null {
    const key = anchor.sourceSequence + ":" + anchor.timestamp;
    if (this.anchors.has(key)) return this.anchors.get(key)!;
    const bars = this.bars;
    const sequence = anchor.sourceSequence;
    let result: number | null;
    if (!bars.length) result = null;
    else if (sequence !== null && Number.isFinite(sequence)) {
      const index = upperBound(bars, sequence, "first") - 1;
      if (index >= 0 && sequence <= bars[index].last) result = index;
      else if (sequence >= bars[0].first && sequence <= bars.at(-1)!.last) {
        // Missing source candles retain their former interpolation between real bars.
        result = index + (sequence - bars[index].first) / (bars[index + 1].first - bars[index].first);
      } else if (this.options) result = this.logicalIndexForTimestamp(Date.parse(anchor.timestamp));
      else {
        const edge = index < 0 ? 0 : bars.length - 1;
        const span = edge + 1 < bars.length ? bars[edge + 1].first - bars[edge].first
          : edge > 0 ? bars[edge].first - bars[edge - 1].first : Math.max(1, bars[edge].expected, bars[edge].last - bars[edge].first + 1);
        result = edge + (sequence - bars[edge].first) / span;
      }
    } else result = this.logicalIndexForTimestamp(Date.parse(anchor.timestamp));
    return remember(this.anchors, key, result);
  }

  timestampForLogicalIndex(index: number): number | null {
    if (!Number.isSafeInteger(index) || !this.bars.length) return null;
    if (this.bars[index]) return this.bars[index].time;
    if (this.timestamps.has(index)) return this.timestamps.get(index)!;
    const edge = index < 0 ? 0 : this.bars.length - 1;
    return remember(this.timestamps, index, this.calendar ? this.calendar.timestampAtOffset(this.bars[edge].time, index - edge)
      : this.bars[edge].time + (index - edge) * this.interval);
  }
}

// Compatibility for geometry callers without a chart-owned locator. Weak keys do
// not retain old windows; per-window configuration variants also have a small cap.
const locators = new WeakMap<readonly DrawingTimelineBar[], Map<string, DrawingTimelineLocator>>();
export function drawingTimelineLocator(bars: readonly DrawingTimelineBar[], interval: number,
  options?: ChartTimelineProjectionOptions) {
  let variants = locators.get(bars);
  if (!variants) { variants = new Map(); locators.set(bars, variants); }
  const key = JSON.stringify([interval, options]);
  let locator = variants.get(key);
  if (!locator) {
    locator = new DrawingTimelineLocator();
    locator.setTimeline(bars, interval, options);
    if (variants.size >= 4) variants.delete(variants.keys().next().value!);
    variants.set(key, locator);
  }
  return locator;
}
