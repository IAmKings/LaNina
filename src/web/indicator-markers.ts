import type { ObservationQuality } from "../domain/ingestion";
import type { IndicatorPointModel, IndicatorSeriesModel } from "../domain/page-models";

/**
 * Marker conventions for public indicator data, kept free of any chart-library
 * import so the page can render the text legend without loading ECharts.
 *
 * Visual conventions shared by the chart and its accessible data table:
 * a revised observation is a diamond, a provisional one is a hollow circle.
 * `label` is rendered as text beside the chart so the marking never relies on
 * colour or shape alone.
 */
export interface ChartPointMarker {
  readonly symbol: string;
  readonly size: number;
  readonly label: string;
}

export interface ChartableIndicatorPoint {
  readonly observedAt: string;
  readonly value: number | null;
  readonly quality: ObservationQuality;
  readonly revision: number;
}

export function chartPointMarker(
  point: Pick<ChartableIndicatorPoint, "quality" | "revision">,
): ChartPointMarker | null {
  if (point.revision > 0) return { symbol: "diamond", size: 11, label: "修订观测" };
  if (point.quality === "provisional") return { symbol: "emptyCircle", size: 9, label: "暂定观测" };
  return null;
}

/** Marker labels actually present in a series, in stable order, for the text legend. */
export function chartMarkerLegend(points: readonly ChartableIndicatorPoint[]): readonly string[] {
  const labels: string[] = [];
  for (const point of points) {
    const marker = chartPointMarker(point);
    if (marker !== null && !labels.includes(marker.label)) labels.push(marker.label);
  }
  return labels;
}

/**
 * Keep a gap for every non-numeric or missing observation. In particular,
 * string labels are useful in the disclosure table but must not be coerced
 * into invented numeric chart values.
 */
export function chartableIndicatorPoints(series: IndicatorSeriesModel): readonly ChartableIndicatorPoint[] {
  return series.points.map((point) => ({
    observedAt: point.observedAt,
    value: typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null,
    quality: point.quality,
    revision: point.revision,
  }));
}

export function hasChartableIndicatorValue(series: IndicatorSeriesModel): boolean {
  return chartableIndicatorPoints(series).some((point) => point.value !== null);
}

/**
 * A marked point keeps its numeric value and only changes the drawn symbol, so
 * the revision/provisional marking never alters the plotted data.
 */
export function chartPointDataItem(
  point: ChartableIndicatorPoint,
): number | null | { readonly value: number; readonly symbol: string; readonly symbolSize: number } {
  if (point.value === null) return null;
  const marker = chartPointMarker(point);
  if (marker === null) return point.value;
  return { value: point.value, symbol: marker.symbol, symbolSize: marker.size };
}

/** Symbol shown next to a disclosure-table row, mirroring the chart marker. */
export function chartPointSymbol(point: Pick<IndicatorPointModel, "quality" | "revision">): string | null {
  const marker = chartPointMarker(point);
  if (marker === null) return null;
  return marker.label === "修订观测" ? "◆" : "○";
}
