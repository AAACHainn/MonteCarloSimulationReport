import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FIBONACCI_RETRACEMENT_STYLE, type FibonacciRetracementDrawing } from "@/lib/market-replay/chart-drawings";
import { FibonacciRetracementPrimitive, hitTestFibonacciRetracements, type FibonacciRetracementPrimitiveSnapshot } from "@/lib/market-replay/fibonacci-retracement-primitive";
import type { AggregatedMarketBarData } from "@/lib/market-replay/types";

const drawing: FibonacciRetracementDrawing = {
  id: "fib-1",
  datasetId: "dataset-1",
  type: "FIB_RETRACEMENT",
  geometry: {
    start: { timestamp: "2026-01-01T00:00:00.000Z", sourceSequence: 0, price: 100 },
    end: { timestamp: "2026-01-01T00:05:00.000Z", sourceSequence: 1, price: 110 },
  },
  style: DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const projected = {
  drawing,
  start: { x: 20, y: 100 },
  end: { x: 120, y: 20 },
  levels: [
    { value: 0, price: 100, color: "#787B86", y: 100 },
    { value: 0.5, price: 105, color: "#4CAF50", y: 60 },
    { value: 1, price: 110, color: "#787B86", y: 20 },
  ],
  selected: false,
};

function setup(style = drawing.style) {
  const primitive = new FibonacciRetracementPrimitive();
  primitive.attached({
    chart: {
      timeScale: () => ({ logicalToCoordinate: (index: number) => index * 100, width: () => 500 }),
      panes: () => [{ getHeight: () => 300 }],
    },
    series: { priceToCoordinate: (price: number) => price },
    requestUpdate: vi.fn(),
  } as never);
  const snapshot: FibonacciRetracementPrimitiveSnapshot = {
    drawings: [{ ...drawing, style }], selectedDrawingId: null, preview: null, draft: null, draftStyle: style,
    bars: [drawing.geometry.start, drawing.geometry.end].map(anchor => ({
      timestamp: anchor.timestamp, firstSequence: anchor.sourceSequence!, lastSequence: anchor.sourceSequence!,
      bucketEnd: new Date(Date.parse(anchor.timestamp) + 300_000).toISOString(),
    })),
    displayIntervalSeconds: 300, sourceIntervalSeconds: 300,
    session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] },
    priceTickSize: 0.01,
  };
  primitive.setDrawings(snapshot);
  primitive.updateAllViews();
  return { primitive, snapshot };
}

function render(primitive: FibonacciRetracementPrimitive) {
  const fillText = vi.fn(), fillRect = vi.fn(), measureText = vi.fn(() => ({ width: 60 }));
  const strokes: string[] = [];
  const context = {
    strokeStyle: "", fillStyle: "", lineWidth: 0, lineCap: "", font: "", textBaseline: "",
    save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke() { strokes.push(this.strokeStyle); }, fillText, fillRect, measureText,
  };
  for (const view of primitive.paneViews()) view.renderer().draw({
    useMediaCoordinateSpace: (draw: (scope: unknown) => void) => draw({ context }),
  } as never);
  return { fillText, fillRect, measureText, strokes };
}

describe("Fibonacci retracement display settings", () => {
  it.each([
    { showPrices: true, showLevels: true, label: "0  100.00" },
    { showPrices: true, showLevels: false, label: "100.00" },
    { showPrices: false, showLevels: true, label: "0" },
    { showPrices: false, showLevels: false, label: null },
  ])("renders independent price/level visibility: %j", ({ showPrices, showLevels, label }) => {
    const { primitive } = setup({ ...drawing.style, showPrices, showLevels });
    const result = render(primitive);
    const enabledCount = drawing.style.levels.filter(level => level.enabled).length;
    expect(result.strokes).toHaveLength(enabledCount);
    expect(primitive.hitTestAt({ x: 50, y: 100 })).toMatchObject({ drawingId: drawing.id, part: "line" });
    if (label === null) {
      expect(result.fillText).not.toHaveBeenCalled();
      expect(result.measureText).not.toHaveBeenCalled();
      expect(result.fillRect).not.toHaveBeenCalled();
    } else {
      expect(result.fillText).toHaveBeenCalledTimes(enabledCount);
      expect(result.fillText.mock.calls[0][0]).toBe(label);
    }
  });

  it("uses one color for saved drawings, geometry previews and drafts without losing individual colors", () => {
    const style = { ...drawing.style, singleColor: "#123456" };
    const { primitive, snapshot } = setup(style);
    const originalColors = drawing.style.levels.map(level => level.color);
    primitive.setDrawings({ ...snapshot, preview: { id: drawing.id, geometry: drawing.geometry }, draft: drawing.geometry });
    primitive.updateAllViews();
    expect(new Set(render(primitive).strokes)).toEqual(new Set(["#123456"]));
    expect(primitive.getDrawingCoordinates(drawing.id)?.levels.every(level => level.color === "#123456")).toBe(true);
    primitive.setDrawings({ ...snapshot, drawings: [{ ...drawing, style: { ...style, singleColor: null } }] });
    primitive.updateAllViews();
    expect(render(primitive).strokes).toEqual(drawing.style.levels.filter(level => level.enabled).map(level => level.color));
    expect(style.levels.map(level => level.color)).toEqual(originalColors);
  });
});

describe("Fibonacci retracement primitive hit testing", () => {
  it("hits an enabled horizontal level across the anchor span", () => {
    expect(hitTestFibonacciRetracements([projected], { x: 70, y: 62 })).toMatchObject({
      drawingId: "fib-1", part: "line", priority: 1,
    });
    expect(hitTestFibonacciRetracements([projected], { x: 140, y: 60 })).toBeNull();
  });

  it("prioritizes selected anchor handles over levels", () => {
    expect(hitTestFibonacciRetracements([{ ...projected, selected: true }], { x: 21, y: 101 })).toMatchObject({
      drawingId: "fib-1", part: "start", priority: 2,
    });
  });

  it("does not contribute an autoscale range while drawing or dragging", () => {
    expect("autoscaleInfo" in new FibonacciRetracementPrimitive()).toBe(false);
  });

  it("renders the draft with the configured default levels", () => {
    const bars: AggregatedMarketBarData[] = [0, 1].map((index) => ({
      timestamp: `2026-01-01T00:0${index * 5}:00.000Z`,
      bucketEnd: `2026-01-01T00:${String(index * 5 + 5).padStart(2, "0")}:00.000Z`,
      firstSequence: index,
      lastSequence: index,
      open: 100, high: 110, low: 90, close: 105, volume: 1,
      sourceCount: 1, expectedCount: 1, status: "COMPLETE",
    }));
    const draftStyle = {
      ...DEFAULT_FIBONACCI_RETRACEMENT_STYLE,
      levels: [0, 1, 2].map((value) => ({ value, enabled: true, color: "#F23645" })),
    };
    const primitive = new FibonacciRetracementPrimitive();
    primitive.attached({
      chart: {
        timeScale: () => ({ logicalToCoordinate: (index: number) => index * 100, width: () => 500 }),
        panes: () => [{ getHeight: () => 300 }],
      },
      series: { priceToCoordinate: (price: number) => price },
      requestUpdate: () => undefined,
    } as never);
    primitive.setDrawings({
      drawings: [], selectedDrawingId: null, preview: null,
      draft: {
        start: { timestamp: bars[0].timestamp, sourceSequence: 0, price: 100 },
        end: { timestamp: bars[1].timestamp, sourceSequence: 1, price: 110 },
      },
      draftStyle,
      bars,
      displayIntervalSeconds: 300,
      sourceIntervalSeconds: 60,
      session: { mode: "TWENTY_FOUR_SEVEN", timezone: "UTC", openMinute: null, closeMinute: null, weekdays: [1, 2, 3, 4, 5, 6, 7] },
      priceTickSize: 0.01,
    });
    primitive.updateAllViews();
    const snapshot = primitive as unknown as {
      projected: { draft: { drawing: FibonacciRetracementDrawing; levels: Array<{ value: number }> } | null };
    };
    expect(snapshot.projected.draft?.drawing.style).toEqual(draftStyle);
    expect(snapshot.projected.draft?.levels.map((level) => level.value)).toEqual([0, 1, 2]);
  });

});
