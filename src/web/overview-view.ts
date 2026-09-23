import type { OverviewPageModel, ThesisCardModel } from "../domain/page-models";
import type { SourceHealthStatus } from "../domain/ingestion";

export function stageLabel(stage: ThesisCardModel["stage"]): string {
  const labels: Record<ThesisCardModel["stage"], string> = {
    watch: "观察中",
    weather_realized: "天气已兑现",
    physical_pressure: "实物承压",
    balance_tightening: "供需收紧",
    market_confirmed: "市场确认",
    easing: "压力缓解",
  };

  return labels[stage];
}

export function directionLabel(direction: ThesisCardModel["direction"]): string {
  const labels: Record<ThesisCardModel["direction"], string> = {
    bearish: "偏空",
    bullish: "偏多",
    mixed: "分化",
    neutral: "中性",
  };

  return labels[direction];
}

export function healthLabel(status: SourceHealthStatus): string {
  const labels: Record<SourceHealthStatus, string> = {
    healthy: "正常",
    delayed: "延迟",
    stale: "过期",
    broken: "故障",
  };

  return labels[status];
}

/** Transmission order used by the cross-market risk map; never merged into a single score. */
export const RISK_MAP_STAGES = [
  "watch",
  "weather_realized",
  "physical_pressure",
  "balance_tightening",
  "market_confirmed",
  "easing",
] as const satisfies readonly ThesisCardModel["stage"][];

export interface RiskMapRow {
  readonly stage: ThesisCardModel["stage"];
  readonly stageLabel: string;
  readonly theses: readonly {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly direction: ThesisCardModel["direction"];
    readonly directionLabel: string;
    readonly confidence: number;
    readonly freshness: ThesisCardModel["freshness"];
  }[];
}

/**
 * Groups the six theses by transmission stage for the homepage map. Each stage keeps its own row,
 * including empty ones, because "nothing has reached this stage yet" is itself the signal — the
 * map deliberately never collapses into one aggregate number.
 */
export function riskMapRows(model: OverviewPageModel): readonly RiskMapRow[] {
  return RISK_MAP_STAGES.map((stage) => ({
    stage,
    stageLabel: stageLabel(stage),
    theses: model.theses
      .filter((thesis) => thesis.stage === stage)
      .map((thesis) => ({
        id: thesis.id,
        slug: thesis.slug,
        title: thesis.title,
        direction: thesis.direction,
        directionLabel: directionLabel(thesis.direction),
        confidence: thesis.confidence,
        freshness: thesis.freshness,
      })),
  }));
}

export function riskMapEmptyStageLabel(): string {
  return "暂无处于该阶段的判断";
}

/** The card freshness is a two-state public signal; it is not a source-health status. */
export function freshnessLabel(freshness: ThesisCardModel["freshness"]): string {
  return freshness === "stale" ? "延迟" : "正常";
}

export function formatShanghaiTime(value: string | null): string {
  if (value === null) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(new Date(value));
}

export function hasPublicOverview(model: OverviewPageModel): boolean {
  return model.dailyBrief !== null || model.theses.length > 0;
}
