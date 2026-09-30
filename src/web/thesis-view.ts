import type {
  IndicatorPointModel,
  ThesisCardModel,
  ThesisEvidenceModel,
} from "../domain/page-models";

const TRANSMISSION_STAGES = [
  { id: "watch", label: "气候观察" },
  { id: "weather_realized", label: "区域天气" },
  { id: "physical_pressure", label: "实物" },
  { id: "balance_tightening", label: "供需" },
  { id: "market_confirmed", label: "市场" },
  { id: "easing", label: "缓解" },
] as const satisfies readonly { id: ThesisCardModel["stage"]; label: string }[];

export function transmissionStages(currentStage: ThesisCardModel["stage"]) {
  return TRANSMISSION_STAGES.map((stage) => ({
    ...stage,
    current: stage.id === currentStage,
  }));
}

export function evidenceStanceLabel(stance: ThesisEvidenceModel["stance"]): string {
  return stance === "supports" ? "支持证据" : "反向证据";
}

export function evidenceQualityLabel(quality: ThesisEvidenceModel["quality"], revision: number): string {
  const label: Record<ThesisEvidenceModel["quality"], string> = {
    verified: "已核验",
    provisional: "暂定",
    estimated: "估算",
    manual: "人工录入",
    invalid: "无效",
  };
  return revision > 0 ? `${label[quality]} · 修订 ${revision}` : label[quality];
}

/** 指标数据表默认展示行数（最新在前）；其余行经「显示全部」展开，审计语义不截断。 */
export const INDICATOR_TABLE_VISIBLE_ROWS = 10;

/** 证据列默认展示条数（最新在前）。 */
export const EVIDENCE_VISIBLE_ITEMS = 8;

/**
 * 指标数据表展示顺序：最新观测在前，同观测期取最新修订在前。
 * 图表仍按时间正序消费 points；倒序只用于表格展示。
 */
export function newestFirstPoints(
  points: readonly IndicatorPointModel[],
): readonly IndicatorPointModel[] {
  return [...points].sort((left, right) =>
    right.observedAt.localeCompare(left.observedAt)
    || right.revision - left.revision
    || right.times.fetchedAt.localeCompare(left.times.fetchedAt));
}

/** 证据展示顺序：最新发布在前（发布时间为空回退采集时间，再回退保持稳定）。 */
export function newestFirstEvidence(
  items: readonly ThesisEvidenceModel[],
): readonly ThesisEvidenceModel[] {
  return [...items].sort((left, right) =>
    (right.times.publishedAt ?? right.times.fetchedAt)
      .localeCompare(left.times.publishedAt ?? left.times.fetchedAt)
    || right.times.fetchedAt.localeCompare(left.times.fetchedAt)
    || right.revision - left.revision);
}
