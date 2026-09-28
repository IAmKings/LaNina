import { deepFreeze } from "./internal/freeze";

/**
 * 派生指标（L0 机制）的领域层：从基准指标的 marketing-year 序列计算二级观测值。
 * 本模块是纯计算——没有 IO、没有时钟、没有随机数；读库与写库的装配在 worker 侧
 * （src/worker/modules/derived-indicators.ts + adapters/storage）。
 *
 * USDA FAS PSD 的 marketing-year 存储语义（2026-09-27 读 usda-fas-psd.ts 适配器核实，
 * 派生排序必须与存储完全一致，不新造时序）：
 * - 一个 marketing-year 恰好一条观测：observed_at = MY 期末日（下一个 MY 起点月 1 日的
 *   前一天），period_start = MY 起点日（起点月 1 日）。马来西亚棕榈油 MY 起点 10 月
 *   （MY2025 → observed_at 2026-09-30 / period_start 2025-10-01）；南非玉米 MY 起点
 *   5 月（MY2026 → observed_at 2027-04-30 / period_start 2026-05-01）。
 * - 当期 MY 的估计值在 MY 进行中就会发布，因此 observed_at 可能是未来日期；评估输入
 *   以 fetched_at 过滤，与既有语义一致。
 * - 因此派生层以 period_start 的日历年作为 MY 标识、按 observed_at 排序即 MY 升序；
 *   派生观测沿用当期 MY 基准观测的 observed_at / period_start。
 */

/** 基准指标的一个 marketing-year 观测点（已取同一观测期最新 revision）。 */
export interface MarketYearPoint {
  /** MY 期末日（基准观测的 observed_at，规范 UTC）。 */
  readonly observedAt: string;
  /** MY 起点日（基准观测的 period_start，规范 UTC）；其日历年即 MY 标识。 */
  readonly periodStart: string;
  /** 基准观测值（如 1000 MT 的期末库存/产量）。 */
  readonly value: number;
}

/** 计算出的派生值：observed_at / period_start 沿用当期 MY 的基准观测。 */
export interface DerivedMarketYearValue {
  readonly observedAt: string;
  readonly periodStart: string;
  readonly value: number;
}

/** 缺失/无效输入一律不产出（fail-closed），调用方以 null 判定「本轮无派生观测」。 */
export function marketYearYearOverYearPercent(
  series: readonly MarketYearPoint[],
): DerivedMarketYearValue | null {
  const years = orderedMarketYears(series);
  const current = years.at(-1);
  const previous = years.at(-2);
  if (current === undefined || previous === undefined) return null;
  if (previous.year + 1 !== current.year) return null;
  // 分母（上一 MY 值）必须为正；当期值是合法的非负数（期末库存/产量可为 0）。
  if (!isNonNegativeFinite(current.value) || !isPositiveFinite(previous.value)) return null;
  const value = ((current.value - previous.value) / previous.value) * 100;
  if (!Number.isFinite(value)) return null;
  return deepFreeze({
    observedAt: current.observedAt,
    periodStart: current.periodStart,
    value,
  });
}

/**
 * 当期 MY 对此前 `priorYears` 个 MY 均值的百分比。窗口内任何一年缺失、不连续或
 * 均值非正都 fail-closed（不产出），绝不静默降级为「可用年份的均值」。
 */
export function marketYearVersusPriorMeanPercent(
  series: readonly MarketYearPoint[],
  priorYears: number,
): DerivedMarketYearValue | null {
  if (!Number.isInteger(priorYears) || priorYears <= 0) return null;
  const years = orderedMarketYears(series);
  const current = years.at(-1);
  if (current === undefined) return null;
  if (!isNonNegativeFinite(current.value)) return null;
  const window = years.slice(-(priorYears + 1), -1);
  if (window.length !== priorYears) return null;
  const expectedYears = Array.from(
    { length: priorYears },
    (_, index) => current.year - priorYears + index,
  );
  if (window.some((point, index) => point.year !== expectedYears[index])) return null;
  if (window.some((point) => !isNonNegativeFinite(point.value))) return null;
  const mean = window.reduce((total, point) => total + point.value, 0) / priorYears;
  if (!Number.isFinite(mean) || !isPositiveFinite(mean)) return null;
  const value = ((current.value - mean) / mean) * 100;
  if (!Number.isFinite(value)) return null;
  return deepFreeze({
    observedAt: current.observedAt,
    periodStart: current.periodStart,
    value,
  });
}

interface OrderedMarketYearPoint {
  readonly year: number;
  readonly observedAt: string;
  readonly periodStart: string;
  readonly value: number;
}

/**
 * 归一化输入：以 period_start 日历年为 MY 标识升序排列。任何结构无效——period_start
 * 不可解析、同一 MY 出现多行（存储层本应按 (indicator, observed_at) 取最新 revision
 * 去重）——整体判空，fail-closed。数值合法性由各计算分别校验。
 */
function orderedMarketYears(series: readonly MarketYearPoint[]): readonly OrderedMarketYearPoint[] {
  const byYear = new Map<number, OrderedMarketYearPoint>();
  for (const point of series) {
    const year = marketYearOf(point);
    if (year === null || byYear.has(year)) return [];
    byYear.set(year, {
      year,
      observedAt: point.observedAt,
      periodStart: point.periodStart,
      value: point.value,
    });
  }
  return [...byYear.values()].sort((left, right) => left.year - right.year);
}

function marketYearOf(point: MarketYearPoint): number | null {
  const match = /^(\d{4})-/.exec(point.periodStart);
  if (match === null) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : null;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * 降水距平（Round 2，签字口径 2026-09-27）：N 日窗口实际累计（区域降水日观测，mm/day）
 * 对 WMO 1991–2020 月气候态同窗口常年累计的百分比。常年累计 = 窗口内每个日历日取其
 * 所在月份的月气候态值（mm/day）逐日累加——即各月气候态按其在窗口中的天数加权
 * （签字件 §5.1「按月插值」口径；闰日归 2 月，不设 FEB29 特例）。
 * 距平 % = (实际累计 − 常年累计) / 常年累计 × 100；降水为正值量，负即偏干。
 *
 * fail-closed（任一成立则不产出）：
 * - 窗口起止不是午夜对齐的规范 UTC 时间、窗口为空或超过 MAX_RAIN_WINDOW_DAYS；
 * - 气候态观测不是恰好 12 个月（月序 1..12 各一条）或含负值/非有限值；
 * - 基准日观测在窗口内任一天缺失、重复（同一 UTC 日期多行）或含负值/非有限值；
 * - 常年累计（分母）非正。
 */
export const MAX_RAIN_WINDOW_DAYS = 400;

export interface RainfallDayPoint {
  /** 基准日观测的 observed_at（规范 UTC；区域降水适配器为当日 T00:00:00.000Z）。 */
  readonly observedAt: string;
  /** 当日区域均值降水（mm/day，非负）。 */
  readonly value: number;
}

export interface ClimatologyMonthPoint {
  /** 月序 1（1 月）..12（12 月）。 */
  readonly month: number;
  /** 该月 1991–2020 气候态日均降水（mm/day，非负）。 */
  readonly value: number;
}

export interface RainAnomalyWindow {
  /** 窗口首日（含），午夜对齐规范 UTC。 */
  readonly windowStart: string;
  /** 窗口末日（含），午夜对齐规范 UTC；即派生观测的 observed_at。 */
  readonly windowEnd: string;
}

export interface RainAnomalyValue extends RainAnomalyWindow {
  readonly actualTotalMm: number;
  readonly normalTotalMm: number;
  /** 距平百分比。 */
  readonly value: number;
}

export function rainAnomalyPercent(
  daily: readonly RainfallDayPoint[],
  climatology: readonly ClimatologyMonthPoint[],
  windowStart: string,
  windowEnd: string,
): RainAnomalyValue | null {
  const startDay = utcDateKeyOfTimestamp(windowStart);
  const endDay = utcDateKeyOfTimestamp(windowEnd);
  if (startDay === null || endDay === null) return null;
  const startMs = Date.parse(`${startDay}T00:00:00.000Z`);
  const endMs = Date.parse(`${endDay}T00:00:00.000Z`);
  const dayCount = Math.round((endMs - startMs) / MS_PER_DAY) + 1;
  if (dayCount < 1 || dayCount > MAX_RAIN_WINDOW_DAYS) return null;

  const climatologyByMonth = climatologyMonths(climatology);
  if (climatologyByMonth === null) return null;

  const dailyByDay = new Map<string, number>();
  for (const point of daily) {
    const day = utcDateKeyOfTimestamp(point.observedAt);
    if (day === null || dailyByDay.has(day)) return null;
    if (!isNonNegativeFinite(point.value)) return null;
    dailyByDay.set(day, point.value);
  }

  let actualTotal = 0;
  let normalTotal = 0;
  for (let index = 0; index < dayCount; index += 1) {
    const day = dateKeyFromMs(startMs + index * MS_PER_DAY);
    const actual = dailyByDay.get(day);
    if (actual === undefined) return null;
    const normal = climatologyByMonth.get(utcMonthOfDayKey(day));
    if (normal === undefined) return null;
    actualTotal += actual;
    normalTotal += normal;
  }
  if (!Number.isFinite(actualTotal) || !isPositiveFinite(normalTotal)) return null;
  const value = ((actualTotal - normalTotal) / normalTotal) * 100;
  if (!Number.isFinite(value)) return null;
  return deepFreeze({
    windowStart,
    windowEnd,
    actualTotalMm: actualTotal,
    normalTotalMm: normalTotal,
    value,
  });
}

function climatologyMonths(
  climatology: readonly ClimatologyMonthPoint[],
): ReadonlyMap<number, number> | null {
  if (climatology.length !== 12) return null;
  const byMonth = new Map<number, number>();
  for (const point of climatology) {
    if (!Number.isInteger(point.month) || point.month < 1 || point.month > 12) return null;
    if (byMonth.has(point.month)) return null;
    if (!isNonNegativeFinite(point.value)) return null;
    byMonth.set(point.month, point.value);
  }
  return byMonth;
}

/**
 * 最近已完结的 11–3 月作物窗口（南部非洲主种植季）：窗口 = Y 年 11 月 1 日至 Y+1 年
 * 3 月 31 日；「完结」按日历判定（3 月 31 日 ≤ cutoff 的 UTC 日期）——窗口内基准观测
 * 是否齐全由 rainAnomalyPercent 的缺口 fail-closed 兜底（NASA 有约 3 日发布滞后）。
 * observed_at = 窗口期末（Y+1 年 3 月 31 日）。
 * cutoff 是评估 cron 的 scheduledAt（22:30 等任意时刻）：按其 UTC 日期判定，非午夜
 * 对齐但必须毫秒精度规范 UTC，其余形态 fail-closed。
 */
export function latestCompletedCropWindow(cutoff: string): RainAnomalyWindow | null {
  const cutoffDay = utcDayKeyOfCanonicalTimestamp(cutoff);
  if (cutoffDay === null) return null;
  const cutoffYear = Number(cutoffDay.slice(0, 4));
  if (!Number.isInteger(cutoffYear)) return null;
  // windowEnd = Y+1 年 3 月 31 日 ≤ cutoff ⇒ 取满足该条件的最大 Y：
  // cutoff 已过当年 3 月 31 日 → Y = 当年 − 1；否则 Y = 当年 − 2。
  const startYear = cutoffDay >= `${cutoffYear}-03-31` ? cutoffYear - 1 : cutoffYear - 2;
  return deepFreeze({
    windowStart: `${startYear}-11-01T00:00:00.000Z`,
    windowEnd: `${startYear + 1}-03-31T00:00:00.000Z`,
  });
}

/**
 * 以基准日观测的最新观测日为期末的最近 N 日滚动窗口（含两端）。窗口期末取「最新可得
 * 观测日」而非日历昨日：NASA POWER 日值有约 3 日发布滞后，按昨日取期末将因缺口永久
 * fail-closed；滞后语义由缺口校验与上游 SLO 共同兜底。
 */
export function rollingRainWindowEndingAt(
  latestObservedAt: string,
  windowDays: number,
): RainAnomalyWindow | null {
  const endDay = utcDateKeyOfTimestamp(latestObservedAt);
  if (endDay === null) return null;
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > MAX_RAIN_WINDOW_DAYS) {
    return null;
  }
  const endMs = Date.parse(`${endDay}T00:00:00.000Z`);
  const startDay = dateKeyFromMs(endMs - (windowDays - 1) * MS_PER_DAY);
  return deepFreeze({
    windowStart: `${startDay}T00:00:00.000Z`,
    windowEnd: `${endDay}T00:00:00.000Z`,
  });
}

/** 降水距平派生的输入（worker 装配层加载，纯计算消费）。 */
export interface RainAnomalySeriesInput {
  readonly daily: readonly RainfallDayPoint[];
  readonly climatology: readonly ClimatologyMonthPoint[];
  /** 重算时点（= scheduledAt）；作物窗口按它选取最近已完结窗口。 */
  readonly cutoff: string;
}

export interface DerivedRainAnomalyValue {
  /** 派生观测 observed_at = 窗口期末（午夜对齐规范 UTC）。 */
  readonly observedAt: string;
  /** 派生观测 period_start = 窗口首日。 */
  readonly periodStart: string;
  readonly value: number;
  readonly actualTotalMm: number;
  readonly normalTotalMm: number;
}

export function computeRainAnomalyIndicator(
  definition: DerivedIndicatorDefinition,
  input: RainAnomalySeriesInput,
): DerivedRainAnomalyValue | null {
  const window = rainAnomalyWindowFor(definition.computation, input);
  if (window === null) return null;
  const anomaly = rainAnomalyPercent(input.daily, input.climatology, window.windowStart, window.windowEnd);
  if (anomaly === null) return null;
  return deepFreeze({
    observedAt: window.windowEnd,
    periodStart: window.windowStart,
    value: anomaly.value,
    actualTotalMm: anomaly.actualTotalMm,
    normalTotalMm: anomaly.normalTotalMm,
  });
}

function rainAnomalyWindowFor(
  computation: DerivedComputation,
  input: RainAnomalySeriesInput,
): RainAnomalyWindow | null {
  switch (computation.kind) {
    case "rain_anomaly_rolling_days": {
      const latest = latestRainfallDay(input.daily);
      if (latest === null) return null;
      return rollingRainWindowEndingAt(latest, computation.windowDays);
    }
    case "rain_anomaly_crop_window":
      return latestCompletedCropWindow(input.cutoff);
    default:
      return null;
  }
}

/** 最新日观测的 observed_at（输入无需预排序；结构非法 fail-closed）。 */
function latestRainfallDay(daily: readonly RainfallDayPoint[]): string | null {
  let latest: string | null = null;
  for (const point of daily) {
    if (utcDateKeyOfTimestamp(point.observedAt) === null) return null;
    if (latest === null || point.observedAt > latest) latest = point.observedAt;
  }
  return latest;
}

const MS_PER_DAY = 86_400_000;
const UTC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** 午夜对齐规范 UTC 时间戳 → 其 UTC 日期键（YYYY-MM-DD）；否则 null。 */
function utcDateKeyOfTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)) return null;
  const day = value.slice(0, 10);
  return isCalendarDay(day) ? day : null;
}

/** 任意毫秒精度规范 UTC 时间戳（评估 cron 的 scheduledAt 时刻）→ 其 UTC 日期键；否则 null。 */
function utcDayKeyOfCanonicalTimestamp(value: string): string | null {
  if (!CANONICAL_UTC_PATTERN.test(value)) return null;
  const day = value.slice(0, 10);
  return isCalendarDay(day) ? day : null;
}

function utcMonthOfDayKey(day: string): number {
  return Number(day.slice(5, 7));
}

function dateKeyFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isCalendarDay(day: string): boolean {
  if (!UTC_DATE_PATTERN.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || date < 1) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return date <= lastDay;
}

/**
 * 派生定义注册表：派生指标 ← 基准指标 + 计算形态。marketing-year 两类（Round 1）与降水
 * 距平三类（Round 2，签字口径 2026-09-27：基准期 WMO 1991–2020 月气候态）。
 * parentSourceId 是评估管道的结构不变量：loadEvaluationInputs 以
 * `run.source_id = indicators.source_id` 连接观测与来源，派生观测的 source_run_id
 * 指向基准观测的 run，因此派生指标、基准指标与气候态指标必须同源——装配层据此 fail-closed。
 * 降水距平类还依赖同父源的月气候态指标（迁移 0014 的 `*_rainfall_climatology_monthly`），
 * climatologyIndicatorId 声明这一依赖；marketing-year 类为 null。
 */
export type DerivedComputation =
  | { readonly kind: "market_year_yoy_pct" }
  | { readonly kind: "market_year_vs_prior_mean_pct"; readonly priorYears: number }
  /** 最近 N 日窗口（窗口期末 = 基准日观测序列的最新观测日）的降水距平。 */
  | { readonly kind: "rain_anomaly_rolling_days"; readonly windowDays: number }
  /** 11–3 月跨年作物窗口（南部非洲玉米）；窗口按 cutoff 取最近已完结窗口。 */
  | { readonly kind: "rain_anomaly_crop_window" };

export interface DerivedIndicatorDefinition {
  readonly derivedIndicatorId: string;
  readonly baseIndicatorId: string;
  /** 降水距平类的基准气候态指标（月序 12 观测）；marketing-year 类为 null。 */
  readonly climatologyIndicatorId: string | null;
  readonly parentSourceId: string;
  readonly computation: DerivedComputation;
}

export const DERIVED_INDICATOR_DEFINITIONS: readonly DerivedIndicatorDefinition[] = deepFreeze([
  {
    derivedIndicatorId: "usda_malaysia_palm_ending_stocks_yoy_pct",
    baseIndicatorId: "usda_psd_malaysia_palm_oil_ending_stocks_1000mt",
    climatologyIndicatorId: null,
    parentSourceId: "usda_psd_malaysia_palm_oil",
    computation: { kind: "market_year_yoy_pct" },
  },
  {
    derivedIndicatorId: "sa_maize_production_vs_5yr_mean_pct",
    baseIndicatorId: "usda_psd_south_africa_corn_production_1000mt",
    climatologyIndicatorId: null,
    parentSourceId: "usda_psd_south_africa_corn",
    computation: { kind: "market_year_vs_prior_mean_pct", priorYears: 5 },
  },
  {
    derivedIndicatorId: "thai_rain_anomaly_30d_pct",
    baseIndicatorId: "regional_rainfall_southern_thailand_rubber_v1",
    climatologyIndicatorId: "thai_rainfall_climatology_monthly",
    parentSourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
    computation: { kind: "rain_anomaly_rolling_days", windowDays: 30 },
  },
  {
    derivedIndicatorId: "sea_rain_anomaly_90d_pct",
    baseIndicatorId: "regional_rainfall_maritime_continent_palm_v1",
    climatologyIndicatorId: "sea_rainfall_climatology_monthly",
    parentSourceId: "nasa_power_rainfall_maritime_continent_palm_v1",
    computation: { kind: "rain_anomaly_rolling_days", windowDays: 90 },
  },
  {
    derivedIndicatorId: "sa_maize_rain_anomaly_crop_window_pct",
    baseIndicatorId: "regional_rainfall_southern_africa_maize_v1",
    climatologyIndicatorId: "sa_maize_rainfall_climatology_monthly",
    parentSourceId: "nasa_power_rainfall_southern_africa_maize_v1",
    computation: { kind: "rain_anomaly_crop_window" },
  },
] satisfies readonly DerivedIndicatorDefinition[]);

export function computeDerivedIndicator(
  definition: DerivedIndicatorDefinition,
  series: readonly MarketYearPoint[],
): DerivedMarketYearValue | null {
  switch (definition.computation.kind) {
    case "market_year_yoy_pct":
      return marketYearYearOverYearPercent(series);
    case "market_year_vs_prior_mean_pct":
      return marketYearVersusPriorMeanPercent(series, definition.computation.priorYears);
    case "rain_anomaly_rolling_days":
    case "rain_anomaly_crop_window":
      // 降水距平的输入形态不同（日观测 + 月气候态 + cutoff），走 computeRainAnomalyIndicator。
      throw new TypeError("rain anomaly computations require computeRainAnomalyIndicator");
  }
}

export function isMarketYearComputation(computation: DerivedComputation): boolean {
  return computation.kind === "market_year_yoy_pct"
    || computation.kind === "market_year_vs_prior_mean_pct";
}

/** 派生计算 label（写入派生观测的 metadata.computation）。 */
export function computationKindLabel(computation: DerivedComputation): string {
  switch (computation.kind) {
    case "market_year_yoy_pct":
      return "market_year_yoy_pct";
    case "market_year_vs_prior_mean_pct":
      return `market_year_vs_prior_mean_pct:${computation.priorYears}`;
    case "rain_anomaly_rolling_days":
      return `rain_anomaly_rolling_days:${computation.windowDays}`;
    case "rain_anomaly_crop_window":
      return "rain_anomaly_crop_window:nov_mar";
  }
}
