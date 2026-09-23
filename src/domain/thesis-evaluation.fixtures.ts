import type {
  EvidenceSelectionResult,
  EvidenceStance,
  EvaluationEvidenceInput,
  RejectedEvidence,
} from "./evaluation";
import { INITIAL_THESIS_SEEDS } from "./initial-thesis-seeds";
import type { IndicatorSelector, ThesisSeed } from "./thesis-seeds";

export const GOLDEN_SCENARIOS = ["support", "refute", "invalidation", "coverage_gap"] as const;

export type GoldenScenario = (typeof GOLDEN_SCENARIOS)[number];

export interface ThesisEvaluationGoldenCase {
  readonly scenario: GoldenScenario;
  readonly seed: ThesisSeed;
  readonly inputs: readonly EvaluationEvidenceInput[];
  readonly expectedSelection: EvidenceSelectionResult;
}

export interface ThesisEvaluationGoldenFixture {
  readonly thesisId: string;
  readonly cases: Readonly<Record<GoldenScenario, ThesisEvaluationGoldenCase>>;
}

const CUTOFF = "2026-09-08T12:00:00.000Z";

export const THESIS_EVALUATION_GOLDEN_FIXTURES: readonly ThesisEvaluationGoldenFixture[] =
  Object.freeze(INITIAL_THESIS_SEEDS.map((seed) => {
    const selector = seed.indicatorSelectors[0];
    if (selector === undefined) throw new TypeError(`${seed.id} 缺少黄金场景所需 selector`);
    return deepFreeze({
      thesisId: seed.id,
      cases: {
        support: goldenCase(seed, selector, "support", "supports", "verified"),
        refute: goldenCase(seed, selector, "refute", "refutes", "verified"),
        invalidation: goldenCase(seed, selector, "invalidation", "context", "verified"),
        coverage_gap: goldenCase(seed, selector, "coverage_gap", "context", null),
      },
    });
  }));

function goldenCase(
  seed: ThesisSeed,
  selector: IndicatorSelector,
  scenario: GoldenScenario,
  stance: EvidenceStance,
  quality: EvaluationEvidenceInput["quality"] | null,
): ThesisEvaluationGoldenCase {
  let inputs: readonly EvaluationEvidenceInput[];
  if (quality === null) {
    inputs = [];
  } else {
    if (scenario === "coverage_gap") throw new TypeError("coverage-gap 黄金场景不得伪造证据");
    inputs = [goldenEvidence(seed, selector, scenario, stance, quality)];
  }
  const rejectedEvidence: RejectedEvidence[] = [];
  if (inputs[0] !== undefined) {
    rejectedEvidence.push({
      evidenceId: inputs[0].evidenceId,
      selectorId: selector.id,
      indicatorId: selector.indicatorId,
      code: quality === "invalid" ? "INVALID_QUALITY" : "PENDING_SELECTOR",
      reason:
        quality === "invalid"
          ? "观测质量为 invalid"
          : `selector 尚未通过研究审核或未启用；候选 stance=${stance} 未进入规则评估`,
    });
  }
  for (const pendingSelector of seed.indicatorSelectors) {
    rejectedEvidence.push({
      evidenceId: null,
      selectorId: pendingSelector.id,
      indicatorId: pendingSelector.indicatorId,
      code: "MISSING_EVIDENCE",
      reason: "selector 尚未通过研究审核或未启用，按缺失证据处理",
    });
  }
  rejectedEvidence.sort(compareRejected);

  return deepFreeze({
    scenario,
    seed,
    inputs,
    expectedSelection: {
      thesisId: seed.id,
      cutoff: CUTOFF,
      inputs,
      selectedEvidence: [],
      rejectedEvidence,
      coverageGapIds: [...seed.readiness.blockingGapIds].sort(compareText),
    },
  });
}

function goldenEvidence(
  seed: ThesisSeed,
  selector: IndicatorSelector,
  scenario: Exclude<GoldenScenario, "coverage_gap">,
  stance: EvidenceStance,
  quality: EvaluationEvidenceInput["quality"],
): EvaluationEvidenceInput {
  const observedAt = "2026-09-08T09:00:00.000Z";
  return {
    evidenceId: `${seed.id.toLowerCase()}-${scenario}`,
    observationId: `${seed.id.toLowerCase()}-${scenario}-observation`,
    sourceRunId: `${seed.id.toLowerCase()}-run`,
    revision: 0,
    supersedesId: null,
    indicatorId: selector.indicatorId,
    sourceId: sourceIdFor(selector.indicatorId),
    layer: selector.layer,
    stance,
    weight: 0,
    observedAt,
    publishedAt: "2026-09-08T10:00:00.000Z",
    fetchedAt: "2026-09-08T11:00:00.000Z",
    value: candidateValue(seed.id, scenario),
    unit: unitFor(selector.indicatorId),
    quality,
    citationUrl: `https://fixtures.invalid/${seed.id.toLowerCase()}/${scenario}`,
    sourceTier: "A",
    sourceHealth: "healthy",
    freshness: "unknown",
  };
}

function candidateValue(
  thesisId: string,
  scenario: Exclude<GoldenScenario, "coverage_gap">,
): number {
  const values: Record<string, readonly [support: number, refute: number, invalidation: number]> = {
    "ENSO-CORE-01": [1.5, 0.5, 0.8],
    "RUBBER-TH-01": [18.4, 2.7, 7.1],
    "PALM-SEA-01": [1.2, 8.5, 4.3],
    "MAIZE-SA-01": [0.8, 5.2, 2.4],
    "SHIP-USEC-01": [1.0, 12.0, 3.5],
    "SHIP-EU-01": [93.0, 72.0, 81.0],
  };
  const thesisValues = values[thesisId];
  if (thesisValues === undefined) throw new TypeError(`黄金场景引用了未知论点 ${thesisId}`);
  const index = scenario === "support" ? 0 : scenario === "refute" ? 1 : 2;
  return thesisValues[index];
}

function sourceIdFor(indicatorId: string): string {
  if (indicatorId === "enso_roni_ersstv6") return "noaa_cpc_roni";
  if (indicatorId.startsWith("regional_rainfall_")) {
    return `nasa_power_rainfall_${indicatorId.slice("regional_rainfall_".length)}`;
  }
  if (indicatorId.startsWith("usda_psd_malaysia_")) return "usda_psd_malaysia_palm_oil";
  if (indicatorId.startsWith("usda_psd_south_africa_")) return "usda_psd_south_africa_corn";
  if (indicatorId === "eia_europe_brent_spot_usd_per_bbl_daily") return "eia_europe_brent_spot";
  throw new TypeError(`黄金场景引用了未知指标 ${indicatorId}`);
}

function unitFor(indicatorId: string): string {
  if (indicatorId === "enso_roni_ersstv6") return "°C";
  if (indicatorId.startsWith("regional_rainfall_")) return "mm/day";
  if (indicatorId.startsWith("usda_psd_")) return "1000 MT";
  if (indicatorId === "eia_europe_brent_spot_usd_per_bbl_daily") return "USD/bbl";
  throw new TypeError(`黄金场景引用了未知指标 ${indicatorId}`);
}

function compareRejected(left: RejectedEvidence, right: RejectedEvidence): number {
  return compareText(left.selectorId ?? "", right.selectorId ?? "")
    || compareText(left.indicatorId, right.indicatorId)
    || compareText(left.evidenceId ?? "", right.evidenceId ?? "")
    || compareText(left.code, right.code);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
