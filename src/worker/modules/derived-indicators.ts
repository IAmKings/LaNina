import {
  DERIVED_INDICATOR_DEFINITIONS,
  MAX_RAIN_WINDOW_DAYS,
  computeDerivedIndicator,
  computeRainAnomalyIndicator,
  computationKindLabel,
  isMarketYearComputation,
  type ClimatologyMonthPoint,
  type DerivedIndicatorDefinition,
  type MarketYearPoint,
  type RainfallDayPoint,
} from "../../domain/derived-indicators";
import { deepFreeze } from "../../domain/internal/freeze";
import { parseCanonicalUtc } from "../ingestion/time";

/**
 * 派生指标重算（L0 机制）——评估 cron（30 22 * * *）在逐论点评估之前执行，保证评估输入
 * 新鲜。手动 evaluate 不触发重算，使用最新已派生观测（每日冻结语义下的可接受滞后）。
 *
 * 两类计算（签字口径 2026-09-27，design.md）：
 * - marketing-year（USDA 同比 % / 对五年均值比 %）：输入为基准指标的 MY 序列；
 * - 降水距平（Round 2）：输入为基准指标的日观测序列（滚动窗口末端 = 最新观测日）+
 *   同父源月气候态指标（月序 12 观测）+ cutoff（作物窗口按它选最近已完结 11–3 月窗口）。
 *   气候态观测本身的采集由 climatology-refresh 子步骤负责（climatology-refresh.ts）。
 *
 * 幂等写入：同 (indicator_id, observed_at) 派生值未变 → skip；变化 → 新 revision
 * （supersedes 指向前值）。写路径与批次二 revision 内联同一模式
 * （adapters/storage/cloudflare-derived-indicators.ts）。
 *
 * 失败语义：任何派生定义的结构/来源校验失败（VALIDATION）或存储故障（DATABASE）都向上
 * 抛出并使当日评估整体失败（fail-closed、cron 可观测）；基准序列历史不足、气候态不足
 * 12 个月或窗口内基准观测缺口只跳过该定义（insufficient_history），不产出观测、不算错误。
 */

export type DerivedRecalculationErrorCode = "VALIDATION" | "DATABASE";

export class DerivedIndicatorError extends Error {
  constructor(readonly code: DerivedRecalculationErrorCode, message: string) {
    super(message);
    this.name = "DerivedIndicatorError";
  }
}

/**
 * 基准指标序列行（存储适配器返回，含派生写入所需的溯源字段）。marketing-year 与降水日值
 * 共用同一行结构：period_start 对 MY 序列是 MY 起点、对日值序列是该日（= observed_at）。
 */
export interface MarketYearBaseObservation {
  readonly observationId: string;
  readonly observedAt: string;
  readonly periodStart: string;
  readonly value: number;
  readonly unit: string;
  readonly revision: number;
  /** 基准观测的 source_run_id（派生观测的 source_run_id 沿用它）。 */
  readonly sourceRunId: string;
  /** 基准指标所属来源（= indicators.source_id）。 */
  readonly sourceId: string;
  /** 基准观测引用的 run 所属来源（评估管道按 run.source_id = indicators.source_id 连接）。 */
  readonly runSourceId: string;
  readonly citationUrl: string;
}

/** 降水距平的日值基准行：结构同上（period_start = observed_at = 该日）。 */
export type RainfallBaseObservation = MarketYearBaseObservation;

/** 月气候态基准行：月序 1..12 由 observed_at 的 UTC 月份解析（2020-MM-15）。 */
export interface ClimatologyBaseObservation {
  readonly observationId: string;
  /** 月序 1（1 月）..12（12 月）。 */
  readonly month: number;
  readonly value: number;
  readonly revision: number;
  readonly sourceRunId: string;
  readonly sourceId: string;
  readonly runSourceId: string;
  readonly citationUrl: string;
}

export interface MarketYearComputationMetadata {
  readonly computation: string;
  readonly baseIndicatorId: string;
  readonly baseObservationId: string;
  readonly baseRevision: number;
  readonly marketYear: number;
  readonly currentValue: number;
  readonly priorObservations: readonly {
    readonly observationId: string;
    readonly revision: number;
    readonly marketYear: number;
    readonly value: number;
  }[];
}

export interface RainAnomalyComputationMetadata {
  readonly computation: string;
  readonly baseIndicatorId: string;
  /** 窗口末端基准日观测（rolling 的最新日 / 作物窗口的 3 月 31 日行）。 */
  readonly baseObservationId: string;
  readonly baseRevision: number;
  /** 距平窗口（observed_at = windowEnd，period_start = windowStart）。 */
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly actualTotalMm: number;
  readonly normalTotalMm: number;
  readonly climatologyIndicatorId: string;
}

export type DerivedObservationMetadata =
  | MarketYearComputationMetadata
  | RainAnomalyComputationMetadata;

export interface DerivedObservationWrite {
  readonly derivedIndicatorId: string;
  readonly observedAt: string;
  readonly periodStart: string;
  readonly value: number;
  readonly unit: string;
  /** 派生时点（= 本次重算的 scheduledAt），作为派生观测的 fetched_at。 */
  readonly fetchedAt: string;
  readonly sourceRunId: string;
  readonly citationUrl: string;
  readonly metadata: DerivedObservationMetadata;
}

/** 与传入 writes 顺序一一对应的持久化结果。 */
export type PersistedDerivedObservation = "written" | "skipped_unchanged";

export interface DerivedIndicatorRepository {
  loadMarketYearBaseSeries(
    baseIndicatorId: string,
    cutoff: string,
  ): Promise<readonly MarketYearBaseObservation[]>;
  /** 基准指标最近的日观测序列（覆盖最大距平窗口即可，见 MAX_DAILY_RAIN_SERIES_PERIODS）。 */
  loadRecentRainfallSeries(
    baseIndicatorId: string,
    cutoff: string,
  ): Promise<readonly RainfallBaseObservation[]>;
  /** 同父源月气候态指标（月序 12 观测）；不足 12 行由距平计算 fail-closed。 */
  loadClimatologySeries(
    climatologyIndicatorId: string,
    cutoff: string,
  ): Promise<readonly ClimatologyBaseObservation[]>;
  persistDerivedObservations(
    writes: readonly DerivedObservationWrite[],
  ): Promise<readonly PersistedDerivedObservation[]>;
}

export type DerivedIndicatorOutcomeStatus = "written" | "unchanged" | "insufficient_history";

export interface DerivedIndicatorOutcome {
  readonly derivedIndicatorId: string;
  readonly status: DerivedIndicatorOutcomeStatus;
  readonly observedAt: string | null;
  readonly value: number | null;
}

export interface DerivedRecalculationRequest {
  readonly scheduledAt: string;
}

export interface DerivedRecalculationResult {
  readonly scheduledAt: string;
  readonly outcomes: readonly DerivedIndicatorOutcome[];
}

/**
 * 日值基准序列的观测期护栏：最大距平窗口 400 天 + 发布滞后的缓冲。窗口末端取「最新观测日」，
 * 最新 400+ 个观测期必然覆盖任何合法窗口。
 */
export const MAX_DAILY_RAIN_SERIES_PERIODS = MAX_RAIN_WINDOW_DAYS + 10;

export class DerivedIndicatorRecalculationJob {
  constructor(
    private readonly repository: DerivedIndicatorRepository,
    private readonly definitions: readonly DerivedIndicatorDefinition[] = DERIVED_INDICATOR_DEFINITIONS,
  ) {}

  async run(request: DerivedRecalculationRequest): Promise<DerivedRecalculationResult> {
    const scheduledAt = parseCanonicalUtc(request.scheduledAt, "scheduledAt").toISOString();

    const writes: DerivedObservationWrite[] = [];
    const draftOutcomes: DerivedIndicatorOutcome[] = [];
    const pendingIndexes: number[] = [];
    for (const definition of this.definitions) {
      if (isMarketYearComputation(definition.computation)) {
        const prepared = await this.prepareMarketYearWrite(definition, scheduledAt);
        draftOutcomes.push(prepared.outcome);
        if (prepared.write !== null) {
          pendingIndexes.push(draftOutcomes.length - 1);
          writes.push(prepared.write);
        }
      } else {
        const prepared = await this.prepareRainAnomalyWrite(definition, scheduledAt);
        draftOutcomes.push(prepared.outcome);
        if (prepared.write !== null) {
          pendingIndexes.push(draftOutcomes.length - 1);
          writes.push(prepared.write);
        }
      }
    }

    if (writes.length > 0) {
      const persisted = await this.repository.persistDerivedObservations(writes);
      if (persisted.length !== writes.length) {
        throw new DerivedIndicatorError("DATABASE", "派生观测写入结果数量不一致");
      }
      persisted.forEach((status, index) => {
        const draft = draftOutcomes[pendingIndexes[index]!]!;
        draftOutcomes[pendingIndexes[index]!] = {
          ...draft,
          status: status === "written" ? "written" : "unchanged",
        };
      });
    }

    return deepFreeze({ scheduledAt, outcomes: draftOutcomes });
  }

  private async prepareMarketYearWrite(
    definition: DerivedIndicatorDefinition,
    scheduledAt: string,
  ): Promise<PreparedWrite> {
    const series = await this.repository.loadMarketYearBaseSeries(
      definition.baseIndicatorId,
      scheduledAt,
    );
    assertSameSourceParent(definition, series);
    const derived = computeDerivedIndicator(definition, toMarketYearPoints(series));
    if (derived === null) {
      return { outcome: insufficient(definition.derivedIndicatorId), write: null };
    }
    const current = series.at(-1);
    if (current === undefined || current.observedAt !== derived.observedAt) {
      // computeDerivedIndicator 的当期点必须就是序列末点；此处失配属于实现不变量被破坏。
      throw new DerivedIndicatorError("VALIDATION", "派生当期点与基准序列末点不一致");
    }
    return {
      outcome: derivedOutcome(definition.derivedIndicatorId, derived),
      write: {
        derivedIndicatorId: definition.derivedIndicatorId,
        observedAt: derived.observedAt,
        periodStart: derived.periodStart,
        value: derived.value,
        unit: "%",
        fetchedAt: scheduledAt,
        sourceRunId: current.sourceRunId,
        citationUrl: current.citationUrl,
        metadata: {
          computation: computationKindLabel(definition.computation),
          baseIndicatorId: definition.baseIndicatorId,
          baseObservationId: current.observationId,
          baseRevision: current.revision,
          marketYear: marketYearLabel(derived.periodStart),
          currentValue: current.value,
          priorObservations: priorObservations(definition, series),
        },
      },
    };
  }

  private async prepareRainAnomalyWrite(
    definition: DerivedIndicatorDefinition,
    scheduledAt: string,
  ): Promise<PreparedWrite> {
    const daily = await this.repository.loadRecentRainfallSeries(
      definition.baseIndicatorId,
      scheduledAt,
    );
    assertSameSourceParent(definition, daily);
    const climatologyIndicatorId = requireClimatologyIndicatorId(definition);
    const climatology = await this.repository.loadClimatologySeries(
      climatologyIndicatorId,
      scheduledAt,
    );
    assertSameSourceParent(definition, climatology);
    const derived = computeRainAnomalyIndicator(definition, {
      daily: toRainfallDayPoints(daily),
      climatology: toClimatologyMonthPoints(climatology),
      cutoff: scheduledAt,
    });
    if (derived === null) {
      return { outcome: insufficient(definition.derivedIndicatorId), write: null };
    }
    const windowEndRow = daily.find((row) => row.observedAt === derived.observedAt);
    if (windowEndRow === undefined) {
      // 窗口末端必须是序列内已存在的基准观测；失配属于实现不变量被破坏。
      throw new DerivedIndicatorError("VALIDATION", "距平窗口末端与基准日观测序列不一致");
    }
    return {
      outcome: derivedOutcome(definition.derivedIndicatorId, derived),
      write: {
        derivedIndicatorId: definition.derivedIndicatorId,
        observedAt: derived.observedAt,
        periodStart: derived.periodStart,
        value: derived.value,
        unit: "%",
        fetchedAt: scheduledAt,
        sourceRunId: windowEndRow.sourceRunId,
        citationUrl: windowEndRow.citationUrl,
        metadata: {
          computation: computationKindLabel(definition.computation),
          baseIndicatorId: definition.baseIndicatorId,
          baseObservationId: windowEndRow.observationId,
          baseRevision: windowEndRow.revision,
          windowStart: derived.periodStart,
          windowEnd: derived.observedAt,
          actualTotalMm: derived.actualTotalMm,
          normalTotalMm: derived.normalTotalMm,
          climatologyIndicatorId,
        },
      },
    };
  }
}

function requireClimatologyIndicatorId(definition: DerivedIndicatorDefinition): string {
  if (definition.climatologyIndicatorId === null) {
    // 降水距平定义必须声明其气候态基准（注册表不变量，domain 校验之外的装配层护栏）。
    throw new DerivedIndicatorError(
      "VALIDATION",
      `降水距平定义 ${definition.derivedIndicatorId} 缺少气候态基准指标`,
    );
  }
  return definition.climatologyIndicatorId;
}

interface PreparedWrite {
  readonly outcome: DerivedIndicatorOutcome;
  readonly write: DerivedObservationWrite | null;
}

/**
 * 评估管道结构不变量：派生指标、基准指标（含气候态基准）与基准观测的 run 必须同属定义
 * 声明的父源，否则 loadEvaluationInputs 的 `run.source_id = indicators.source_id` 连接会
 * 静默丢行。同源失配是代码/库配置缺陷，一律 VALIDATION fail-closed。
 */
function assertSameSourceParent(
  definition: DerivedIndicatorDefinition,
  series: readonly {
    readonly sourceId: string;
    readonly runSourceId: string;
  }[],
): void {
  for (const row of series) {
    if (row.sourceId !== definition.parentSourceId || row.runSourceId !== definition.parentSourceId) {
      throw new DerivedIndicatorError(
        "VALIDATION",
        `派生指标 ${definition.derivedIndicatorId} 的基准观测来源与父源不一致`,
      );
    }
  }
}

function toMarketYearPoints(
  series: readonly MarketYearBaseObservation[],
): readonly MarketYearPoint[] {
  return series.map((row) => ({
    observedAt: row.observedAt,
    periodStart: row.periodStart,
    value: row.value,
  }));
}

function toRainfallDayPoints(
  series: readonly RainfallBaseObservation[],
): readonly RainfallDayPoint[] {
  return series.map((row) => ({
    observedAt: row.observedAt,
    value: row.value,
  }));
}

function toClimatologyMonthPoints(
  series: readonly ClimatologyBaseObservation[],
): readonly ClimatologyMonthPoint[] {
  return series.map((row) => ({
    month: row.month,
    value: row.value,
  }));
}

function priorObservations(
  definition: DerivedIndicatorDefinition,
  series: readonly MarketYearBaseObservation[],
): MarketYearComputationMetadata["priorObservations"] {
  const computation = definition.computation;
  const priorCount = computation.kind === "market_year_yoy_pct"
    ? 1
    : computation.kind === "market_year_vs_prior_mean_pct"
      ? computation.priorYears
      : null;
  if (priorCount === null) {
    throw new DerivedIndicatorError("VALIDATION", "距平定义没有 marketing-year 前期观测");
  }
  return series
    .slice(-(priorCount + 1), -1)
    .map((row) => ({
      observationId: row.observationId,
      revision: row.revision,
      marketYear: marketYearLabel(row.periodStart),
      value: row.value,
    }));
}

function marketYearLabel(periodStart: string): number {
  const year = Number(periodStart.slice(0, 4));
  if (!Number.isInteger(year)) {
    throw new DerivedIndicatorError("VALIDATION", "基准观测 period_start 不是规范 UTC 日期");
  }
  return year;
}

function derivedOutcome(
  derivedIndicatorId: string,
  derived: { readonly observedAt: string; readonly value: number },
): DerivedIndicatorOutcome {
  return {
    derivedIndicatorId,
    status: "unchanged",
    observedAt: derived.observedAt,
    value: derived.value,
  };
}

function insufficient(derivedIndicatorId: string): DerivedIndicatorOutcome {
  return {
    derivedIndicatorId,
    status: "insufficient_history",
    observedAt: null,
    value: null,
  };
}
