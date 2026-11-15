import {
  CandlestickSeries, LineSeries, LineStyle, LineType,
  type Coordinate, type CreatePriceLineOptions, type IChartApi, type IPriceLine,
  type ISeriesApi, type ISeriesPrimitive, type PriceLineOptions, type Time,
} from "lightweight-charts";
import { candlestickSeriesStyleOptions } from "./candlestick-style";
import { cloneChartDisplay, lineSeriesPoint, type ChartDisplayConfig, type PriceSeriesPoint } from "./chart-display";
import { priceDecimalsForTick } from "./price-ticks";

type Underlying = { kind: "candlestick"; series: ISeriesApi<"Candlestick"> } | { kind: "line"; series: ISeriesApi<"Line"> };
type LineHandle = { real: IPriceLine };

/** Stable view-only facade. Long-lived pointer handlers never capture a removed native series. */
export class ReplayPriceSeries {
  private current: Underlying;
  private config: ChartDisplayConfig;
  private data: PriceSeriesPoint[] = [];
  private readonly primitives = new Set<ISeriesPrimitive<Time>>();
  private readonly lines = new Map<IPriceLine, LineHandle>();

  constructor(private readonly chart: IChartApi, config: ChartDisplayConfig, private readonly tick: number) {
    this.config = cloneChartDisplay(config);
    this.current = this.create(config);
  }
  private create(config: ChartDisplayConfig): Underlying {
    const priceFormat = { type: "price" as const, minMove: this.tick, precision: priceDecimalsForTick(this.tick) };
    return config.chartType === "candlestick"
      ? { kind: "candlestick", series: this.chart.addSeries(CandlestickSeries, { ...candlestickSeriesStyleOptions(config.candlestickStyle), priceFormat }) }
      : { kind: "line", series: this.chart.addSeries(LineSeries, {
        priceFormat, color: config.line.color, lineWidth: 2, lineStyle: LineStyle.Solid, lineType: LineType.Simple,
        pointMarkersVisible: false, crosshairMarkerVisible: true,
      }) };
  }
  private renderData() {
    if (this.current.kind === "candlestick") this.current.series.setData(this.data);
    else this.current.series.setData(this.data.map(point => lineSeriesPoint(point, this.config.line.priceSource)));
  }
  /** Only the native primary series changes. Chart, viewport and all facade handles remain stable. */
  setDisplay(config: ChartDisplayConfig): boolean {
    const previous = this.config;
    this.config = cloneChartDisplay(config);
    if (previous.chartType === config.chartType) {
      if (this.current.kind === "candlestick") this.current.series.applyOptions(candlestickSeriesStyleOptions(config.candlestickStyle));
      else {
        this.current.series.applyOptions({ color: config.line.color });
        if (previous.line.priceSource !== config.line.priceSource) this.renderData();
      }
      return false;
    }
    const logicalRange = this.chart.timeScale().getVisibleLogicalRange();
    const old = this.current.series;
    const order = old.seriesOrder();
    const scale = old.priceScale();
    const autoScale = scale.options().autoScale;
    const priceRange = !autoScale ? scale.getVisibleRange() : null;
    const lineOptions = [...this.lines.values()].map(line => ({ line, options: { ...line.real.options() } }));
    for (const primitive of this.primitives) old.detachPrimitive(primitive);
    this.current = this.create(config);
    this.renderData();
    this.chart.removeSeries(old);
    // Keep the primary formatter and EMA paint order unchanged after replacement.
    this.current.series.setSeriesOrder(order);
    for (const { line, options } of lineOptions) line.real = this.current.series.createPriceLine(options);
    for (const primitive of this.primitives) this.current.series.attachPrimitive(primitive);
    if (logicalRange) this.chart.timeScale().setVisibleLogicalRange(logicalRange);
    this.current.series.priceScale().applyOptions({ autoScale });
    if (priceRange) this.current.series.priceScale().setVisibleRange(priceRange);
    return true;
  }
  setData(data: PriceSeriesPoint[]) { this.data = data.slice(); this.renderData(); }
  update(point: PriceSeriesPoint) {
    const last = this.data.at(-1);
    if (last?.time === point.time) this.data[this.data.length - 1] = point;
    else this.data.push(point);
    if (this.current.kind === "candlestick") this.current.series.update(point);
    else this.current.series.update(lineSeriesPoint(point, this.config.line.priceSource));
  }
  priceToCoordinate(price: number) { return this.current.series.priceToCoordinate(price); }
  coordinateToPrice(y: Coordinate) { return this.current.series.coordinateToPrice(y); }
  priceScale() { return this.current.series.priceScale(); }
  attachPrimitive(primitive: ISeriesPrimitive<Time>) {
    if (this.primitives.has(primitive)) return;
    this.primitives.add(primitive); this.current.series.attachPrimitive(primitive);
  }
  detachPrimitive(primitive: ISeriesPrimitive<Time>) {
    if (!this.primitives.delete(primitive)) return;
    this.current.series.detachPrimitive(primitive);
  }
  createPriceLine(options: CreatePriceLineOptions): IPriceLine {
    const line: LineHandle = { real: this.current.series.createPriceLine(options) };
    const handle: IPriceLine = {
      applyOptions: (next: Partial<PriceLineOptions>) => line.real.applyOptions(next),
      options: () => line.real.options(),
    };
    this.lines.set(handle, line);
    return handle;
  }
  removePriceLine(handle: IPriceLine) {
    const line = this.lines.get(handle);
    if (line) { this.current.series.removePriceLine(line.real); this.lines.delete(handle); }
  }
}
