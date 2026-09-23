import type { ThesisCardModel, ThesisEvidenceModel } from "../domain/page-models";

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
