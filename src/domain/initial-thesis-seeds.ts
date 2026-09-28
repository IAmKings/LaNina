import type { EvidenceLayer } from "./evaluation";
import type {
  DirectionPolicy,
  PromotableThesisStage,
  RuleDescriptor,
  StageGateDescriptor,
  ThesisSeed,
} from "./thesis-seeds";
import {
  approvedSlo,
  approvedNumericRule,
  decodeThesisSeeds,
  EMPTY_PENDING_THRESHOLDS,
  APPROVED_CONFIDENCE_POLICY,
  approvedDirectionPolicy,
  approvedRule,
  approvedSelector,
  approvedStageGates,
} from "./thesis-seeds";

/**
 * 六个初始种子共享的结构约定（批次三 R3 工厂化；文案与阈值是已签字研究数据，只收敛结构不改内容）：
 * - 规则 id 一律为 `<prefix>-support|-refute|-invalidate|-relief`，每条规则是 approvedRule 的
 *   selector_present（minimumMatches=1），四条规则引用同一组 selector；
 * - stageGates 的 promotion 规则为 `<prefix>-support`，easing 规则为 `<prefix>-relief` 与
 *   `<prefix>-invalidate`（approvedStageGates）；
 * - directionPolicy 对全部四条规则建立映射，方向由 approvedDirectionPolicy 按规则 id 后缀解析；
 * - readiness 六种子仅 publication 与 blockingGapIds 不同。
 */
interface SelectorPresentRuleCopy {
  readonly support: readonly [label: string, reason: string];
  readonly refute: readonly [label: string, reason: string];
  readonly invalidate: readonly [label: string, reason: string];
  readonly relief: readonly [label: string, reason: string];
}

function selectorPresentRules(
  prefix: string,
  selectorIds: readonly string[],
  copy: SelectorPresentRuleCopy,
  extraSupportRules: readonly RuleDescriptor[] = [],
): Pick<ThesisSeed, "supportRules" | "refuteRules" | "invalidationRules" | "reliefRules"> {
  return {
    supportRules: [
      approvedRule(`${prefix}-support`, copy.support[0], copy.support[1], selectorIds),
      ...extraSupportRules,
    ],
    refuteRules: [approvedRule(`${prefix}-refute`, copy.refute[0], copy.refute[1], selectorIds)],
    invalidationRules: [approvedRule(`${prefix}-invalidate`, copy.invalidate[0], copy.invalidate[1], selectorIds)],
    reliefRules: [approvedRule(`${prefix}-relief`, copy.relief[0], copy.relief[1], selectorIds)],
  };
}

/** 橡胶/棕榈/玉米三种子逐字相同的 stageGates 证据层映射；USEC 的 market_confirmed 缺 market，保持显式。 */
const STANDARD_GATE_LAYERS: Readonly<Record<PromotableThesisStage, readonly EvidenceLayer[]>> = {
  weather_realized: ["weather"],
  physical_pressure: ["weather", "physical"],
  balance_tightening: ["weather", "physical", "balance"],
  market_confirmed: ["weather", "physical", "market"],
  easing: ["weather", "physical"],
};

const PALM_SELECTOR_IDS = [
  "palm-rainfall-proxy",
  "palm-usda-production-estimate",
  "palm-usda-exports-estimate",
  "palm-usda-stocks-estimate",
] as const;

const MAIZE_SELECTOR_IDS = [
  "maize-rainfall-proxy",
  "maize-usda-production-estimate",
  "maize-usda-exports-estimate",
  "maize-usda-stocks-estimate",
] as const;

function stageGatesFor(
  prefix: string,
  requiredLayers: Readonly<Record<PromotableThesisStage, readonly EvidenceLayer[]>>,
): readonly StageGateDescriptor[] {
  return approvedStageGates(`${prefix}-support`, [`${prefix}-relief`, `${prefix}-invalidate`], requiredLayers);
}

function directionPolicyFor(prefix: string, ...extraRuleIds: readonly string[]): DirectionPolicy {
  return approvedDirectionPolicy([
    `${prefix}-support`,
    ...extraRuleIds,
    `${prefix}-refute`,
    `${prefix}-invalidate`,
    `${prefix}-relief`,
  ]);
}

function readinessFor(publication: boolean, blockingGapIds: readonly string[]): ThesisSeed["readiness"] {
  return {
    reviewStatus: "approved",
    productionEvaluation: true,
    publication,
    marketEvidenceReady: false,
    blockingGapIds: [...blockingGapIds],
  };
}

const initialThesisSeedDefinitions = [
  {
    id: "ENSO-CORE-01",
    slug: "enso-core",
    title: "当前 ENSO 强度与持续时间是否继续增强",
    category: "climate",
    region: "global",
    marketScope: "RONI/ONI 与区域风险窗口",
    methodologyVersion: "evaluation-v1-draft",
    regionDefinitionVersion: "global-v1",
    target: "RONI/ONI 强度及其区域风险窗口",
    timeHorizon: "未来 1–3 个月",
    defaultDirection: "neutral",
    requiredEvidenceLayers: ["weather"],
    indicatorSelectors: [
      approvedSelector(
        "enso-roni",
        "enso_roni_ersstv6",
        "weather",
        "supports",
        "NOAA RONI 是已观测海温状态；不能替代独立机构的 ENSO 确认。",
      ),
    ],
    freshnessSlos: [approvedSlo("enso-roni", 64800)],
    // D3 数值规则签字（2026-09-26，threshold-worksheet §2.1/§7）：阈值 ≥ +0.5°C 取 NOAA 官方
    // 档位「弱」的下限（厄尔尼诺事件确立线），左值为 RONI（ERSSTv6）最新观测，单位与
    // noaa-roni 适配器输出逐字一致。组合而非替换：enso-support 存在性规则保留（阶段门继续
    // 引用），本规则只作为方向条件——命中即解除 D1 过渡守卫并判偏多，未命中时方向仍不可判。
    ...selectorPresentRules("enso", ["enso-roni"], {
      support: ["ENSO 强度与持续性增强", "阈值和连续确认次数待研究审核"],
      refute: ["ENSO 强度或持续性减弱", "阈值和连续确认次数待研究审核"],
      invalidate: ["权威机构撤销或反转事件判断", "独立来源资格待研究审核"],
      relief: ["关键指标连续回落", "缓解阈值和连续次数待研究审核"],
    }, [
      approvedNumericRule(
        "enso-numeric-support",
        "RONI 达到或超过 +0.5°C（厄尔尼诺事件确立线）",
        "enso-roni",
        "gte",
        0.5,
        "°C",
      ),
    ]),
    stageGates: stageGatesFor("enso", {
      weather_realized: ["weather"],
      physical_pressure: ["weather"],
      balance_tightening: ["weather"],
      market_confirmed: ["weather"],
      easing: ["weather"],
    }),
    // enso-numeric-support 与 enso-support 同为 -support 后缀 → 偏多（id 后缀推断机制不破坏）。
    directionPolicy: directionPolicyFor("enso", "enso-numeric-support"),
    confidencePolicy: APPROVED_CONFIDENCE_POLICY,
    materialChangeThresholds: EMPTY_PENDING_THRESHOLDS,
    templateCopy: {
      summary: "当前仅可描述 NOAA RONI 观测，不能据此单独确认 ENSO 强度和持续期。",
      invalidation: "独立机构确认与强度阈值经研究审核后，才能启用失效判定。",
      coverageGap: "缺少独立 ENSO 机构的结构化确认。",
    },
    coverageGaps: [
      {
        id: "enso-independent-confirmation",
        layer: "weather",
        description: "WMO、BoM 或 IRI 的独立 ENSO 确认尚未接入。",
        blocks: ["confidence", "publication"],
      },
    ],
    readiness: readinessFor(true, ["enso-independent-confirmation"]),
  },
  {
    id: "RUBBER-TH-01",
    slug: "thailand-natural-rubber",
    title: "泰国主产区天气是否减少割胶并收紧天然橡胶原料",
    category: "rubber",
    region: "thailand-south",
    marketScope: "RU、NR、TSR20、RSS3",
    methodologyVersion: "evaluation-v1-draft",
    regionDefinitionVersion: "southern-thailand-rubber-v1",
    target: "RU/NR 近月及泰国天然橡胶原料",
    timeHorizon: "未来 2–8 周",
    defaultDirection: "neutral",
    requiredEvidenceLayers: ["weather", "physical", "balance", "market"],
    indicatorSelectors: [
      approvedSelector(
        "rubber-rainfall-proxy",
        "regional_rainfall_southern_thailand_rubber_v1",
        "weather",
        "supports",
        "NASA 点位等权区域降水代理，不是泰国官方主产区面雨量。",
      ),
      approvedSelector(
        "rubber-rain-anomaly-30d",
        "thai_rain_anomaly_30d_pct",
        "weather",
        "supports",
        "泰国橡胶 30 日降水距平（WMO 1991–2020）。负值表示偏干。存在性规则不引用本 selector。",
      ),
    ],
    freshnessSlos: [
      approvedSlo("rubber-rainfall-proxy", 11520),
      approvedSlo("rubber-rain-anomaly-30d", 11520),
    ],
    ...selectorPresentRules("rubber", ["rubber-rainfall-proxy"], {
      support: ["降水与割胶受阻共同增强", "区域和实物阈值待研究审核"],
      refute: ["原料供应或库存改善", "实物和库存来源尚未接入"],
      invalidate: ["降水恢复且供应连续改善", "连续期数和阈值待研究审核"],
      relief: ["天气与供应压力缓解", "缓解条件待研究审核"],
    }, [
      approvedNumericRule(
        "rubber-numeric-anomaly-support",
        "泰国 30 日降水距平低于常年 25% 以上",
        "rubber-rain-anomaly-30d",
        "lt",
        -25,
        "%",
      ),
    ]),
    stageGates: stageGatesFor("rubber", STANDARD_GATE_LAYERS),
    directionPolicy: directionPolicyFor("rubber", "rubber-numeric-anomaly-support"),
    confidencePolicy: APPROVED_CONFIDENCE_POLICY,
    materialChangeThresholds: EMPTY_PENDING_THRESHOLDS,
    templateCopy: {
      summary: "区域降水代理仅提供天气背景，尚不能证明割胶、库存或市场已受影响。",
      invalidation: "降水恢复、原料供应改善且库存连续上升的具体门槛待研究审核。",
      coverageGap: "缺少合法可用的橡胶实物、库存和市场数据。",
    },
    coverageGaps: [
      {
        id: "rubber-physical-market",
        layer: "physical",
        description: "割胶天数及杯胶、胶水等原料现货来源尚未接入。",
        blocks: ["stage", "confidence", "publication"],
      },
      {
        id: "rubber-balance",
        layer: "balance",
        description: "许可库存、进口或轮胎开工率来源尚未接入。",
        blocks: ["stage", "confidence", "publication"],
      },
      {
        id: "rubber-licensed-market",
        layer: "market",
        description: "RU、NR、TSR20、RSS3 及期限结构的许可行情尚未接入。",
        blocks: ["stage", "confidence", "market_readiness", "publication"],
      },
    ],
    readiness: readinessFor(true, ["rubber-physical-market", "rubber-balance", "rubber-licensed-market"]),
  },
  {
    id: "PALM-SEA-01",
    slug: "southeast-asia-palm-oil",
    title: "印尼与马来西亚水分压力是否滞后压低棕榈油产量",
    category: "agriculture",
    region: "indonesia-malaysia",
    marketScope: "棕榈油及棕榈油—豆油价差",
    methodologyVersion: "evaluation-v1-draft",
    regionDefinitionVersion: "maritime-continent-palm-v1",
    target: "棕榈油及棕榈油—豆油价差",
    timeHorizon: "未来 3–12 个月",
    defaultDirection: "neutral",
    requiredEvidenceLayers: ["weather", "physical", "balance", "market"],
    indicatorSelectors: [
      approvedSelector(
        "palm-rainfall-proxy",
        "regional_rainfall_maritime_continent_palm_v1",
        "weather",
        "supports",
        "NASA 点位等权区域降水代理，区域定义仍待研究审核。",
      ),
      approvedSelector(
        "palm-usda-production-estimate",
        "usda_psd_malaysia_palm_oil_production_1000mt",
        "physical",
        "supports",
        "USDA marketing-year estimate，不是 MPOB 月度实际产量。",
      ),
      approvedSelector(
        "palm-usda-exports-estimate",
        "usda_psd_malaysia_palm_oil_exports_1000mt",
        "balance",
        "supports",
        "USDA marketing-year estimate，不是月度实际出口。",
      ),
      approvedSelector(
        "palm-usda-stocks-estimate",
        "usda_psd_malaysia_palm_oil_ending_stocks_1000mt",
        "balance",
        "supports",
        "USDA marketing-year estimate，不是 MPOB 月度实际库存。",
      ),
      approvedSelector(
        "palm-rain-anomaly-90d",
        "sea_rain_anomaly_90d_pct",
        "weather",
        "supports",
        "海岛棕榈 90 日降水距平（WMO 1991–2020）。负值表示偏干。存在性规则不引用本 selector。",
      ),
      approvedSelector(
        "palm-ending-stocks-yoy",
        "usda_malaysia_palm_ending_stocks_yoy_pct",
        "balance",
        "supports",
        "马来西亚棕榈油期末库存同比。负值表示去库。存在性规则不引用本 selector。",
      ),
    ],
    freshnessSlos: [
      approvedSlo("palm-rainfall-proxy", 11520),
      approvedSlo("palm-usda-production-estimate", 66240),
      approvedSlo("palm-usda-exports-estimate", 66240),
      approvedSlo("palm-usda-stocks-estimate", 66240),
      approvedSlo("palm-rain-anomaly-90d", 11520),
      approvedSlo("palm-ending-stocks-yoy", 66240),
    ],
    ...selectorPresentRules("palm", PALM_SELECTOR_IDS, {
      support: ["水分压力与供应估计同步恶化", "滞后窗口和阈值待研究审核"],
      refute: ["产量、库存或出口反向改善", "MPOB actual 与控制变量尚未接入"],
      invalidate: ["水分与供应压力连续消退", "连续期数待研究审核"],
      relief: ["实际产量和库存确认缓解", "MPOB actual 尚未接入"],
    }, [
      approvedNumericRule(
        "palm-numeric-rain-support",
        "海岛 90 日降水距平低于常年 25% 以上",
        "palm-rain-anomaly-90d",
        "lt",
        -25,
        "%",
      ),
      approvedNumericRule(
        "palm-numeric-stocks-support",
        "马来西亚棕榈油期末库存同比去库超过 10%",
        "palm-ending-stocks-yoy",
        "lt",
        -10,
        "%",
      ),
    ]),
    stageGates: stageGatesFor("palm", STANDARD_GATE_LAYERS),
    directionPolicy: directionPolicyFor("palm", "palm-numeric-rain-support", "palm-numeric-stocks-support"),
    confidencePolicy: APPROVED_CONFIDENCE_POLICY,
    materialChangeThresholds: EMPTY_PENDING_THRESHOLDS,
    templateCopy: {
      summary: "区域降水代理与 USDA 年度估计仅能构成待审核背景，不能替代 MPOB 月度实际数据。",
      invalidation: "水分、实际产量和库存的连续缓解条件待研究审核。",
      coverageGap: "缺少 MPOB 月度实际产量、库存、出口及许可市场指标。",
    },
    coverageGaps: [
      {
        id: "palm-mpob-actuals",
        layer: "physical",
        description: "MPOB 月度实际产量尚未接入；USDA 仅为 marketing-year estimate。",
        blocks: ["stage", "confidence", "publication"],
      },
      {
        id: "palm-market",
        layer: "market",
        description: "棕榈油及棕榈油—豆油价差的许可行情尚未接入。",
        blocks: ["stage", "confidence", "market_readiness", "publication"],
      },
    ],
    readiness: readinessFor(true, ["palm-mpob-actuals", "palm-market"]),
  },
  {
    id: "MAIZE-SA-01",
    slug: "southern-africa-maize",
    title: "南部非洲主种植季偏干是否降低次年玉米供应",
    category: "agriculture",
    region: "southern-africa",
    marketScope: "区域玉米与 CBOT 玉米间接参考",
    methodologyVersion: "evaluation-v1-draft",
    regionDefinitionVersion: "southern-africa-maize-v1",
    target: "南部非洲玉米供应与 CBOT 玉米间接参考",
    timeHorizon: "当前种植季至下一市场年度",
    defaultDirection: "neutral",
    requiredEvidenceLayers: ["weather", "physical", "balance", "market"],
    indicatorSelectors: [
      approvedSelector(
        "maize-rainfall-proxy",
        "regional_rainfall_southern_africa_maize_v1",
        "weather",
        "supports",
        "NASA 点位等权区域降水代理，尚未固化 11–3 月作物窗口。",
      ),
      approvedSelector(
        "maize-usda-production-estimate",
        "usda_psd_south_africa_corn_production_1000mt",
        "physical",
        "supports",
        "USDA marketing-year estimate，不是 CEC forecast 或 SAGIS actual。",
      ),
      approvedSelector(
        "maize-usda-exports-estimate",
        "usda_psd_south_africa_corn_exports_1000mt",
        "balance",
        "supports",
        "USDA marketing-year estimate，不是 SAGIS actual。",
      ),
      approvedSelector(
        "maize-usda-stocks-estimate",
        "usda_psd_south_africa_corn_ending_stocks_1000mt",
        "balance",
        "supports",
        "USDA marketing-year estimate，不是 SAGIS actual。",
      ),
      approvedSelector(
        "maize-production-vs-5yr",
        "sa_maize_production_vs_5yr_mean_pct",
        "physical",
        "supports",
        "南非玉米产量相对此前五个市场年度均值。负值表示低于均值。存在性规则不引用本 selector。",
      ),
      approvedSelector(
        "maize-rain-anomaly-crop-window",
        "sa_maize_rain_anomaly_crop_window_pct",
        "weather",
        "supports",
        "南部非洲玉米 11–3 月作物窗口降水距平（WMO 1991–2020）。窗口一年关闭一次，新鲜度按 365 日。存在性规则不引用本 selector。",
      ),
    ],
    freshnessSlos: [
      approvedSlo("maize-rainfall-proxy", 11520),
      approvedSlo("maize-usda-production-estimate", 66240),
      approvedSlo("maize-usda-exports-estimate", 66240),
      approvedSlo("maize-usda-stocks-estimate", 66240),
      approvedSlo("maize-production-vs-5yr", 66240),
      // 作物窗口 observed_at 停在 3 月 31 日，值未变时不产生新 revision，fetched_at 也就停在
      // 窗口关闭那天。SLO 取解码器允许的上限 365 日，使这条年度信号在下一窗口写出前仍可参与规则。
      approvedSlo("maize-rain-anomaly-crop-window", 525_600),
    ],
    ...selectorPresentRules("maize", MAIZE_SELECTOR_IDS, {
      support: ["作物窗口偏干与供应估计同步恶化", "农时与阈值待研究审核"],
      refute: ["作物状况或供应估计改善", "CEC/SAGIS actual 尚未接入"],
      invalidate: ["作物窗口降水和供应连续恢复", "连续期数待研究审核"],
      relief: ["CEC/SAGIS 实际数据确认缓解", "CEC/SAGIS actual 尚未接入"],
    }, [
      approvedNumericRule(
        "maize-numeric-mean-support",
        "南非玉米产量低于五年均值 15% 以上",
        "maize-production-vs-5yr",
        "lt",
        -15,
        "%",
      ),
      approvedNumericRule(
        "maize-numeric-window-support",
        "南部非洲玉米 11–3 月作物窗口降水距平低于常年 25% 以上",
        "maize-rain-anomaly-crop-window",
        "lt",
        -25,
        "%",
      ),
    ]),
    stageGates: stageGatesFor("maize", STANDARD_GATE_LAYERS),
    directionPolicy: directionPolicyFor("maize", "maize-numeric-mean-support", "maize-numeric-window-support"),
    confidencePolicy: APPROVED_CONFIDENCE_POLICY,
    materialChangeThresholds: EMPTY_PENDING_THRESHOLDS,
    templateCopy: {
      summary: "降水代理和 USDA 年度估计尚不能替代作物窗口观测、CEC forecast 或 SAGIS actual。",
      invalidation: "农时降水恢复与实际供应改善的阈值待研究审核。",
      coverageGap: "缺少 CEC forecast、SAGIS actual 和许可市场指标。",
    },
    coverageGaps: [
      {
        id: "maize-cec-sagis-actuals",
        layer: "physical",
        description: "CEC forecast 与 SAGIS actual 尚未接入；USDA 仅为 marketing-year estimate。",
        blocks: ["stage", "confidence", "publication"],
      },
      {
        id: "maize-market",
        layer: "market",
        description: "区域玉米和 CBOT 间接参考的许可行情尚未接入。",
        blocks: ["stage", "confidence", "market_readiness", "publication"],
      },
    ],
    readiness: readinessFor(true, ["maize-cec-sagis-actuals", "maize-market"]),
  },
  {
    id: "SHIP-USEC-01",
    slug: "asia-us-east",
    title: "巴拿马水约束是否提高亚洲至美东航线时间和成本",
    category: "shipping",
    region: "asia-us-east",
    marketScope: "美东即期运价、等待时间与绕航",
    methodologyVersion: "evaluation-v1-draft",
    regionDefinitionVersion: "asia-usec-v1",
    target: "亚洲至美东即期运价、等待时间与绕航",
    timeHorizon: "未来 1–8 周",
    defaultDirection: "neutral",
    requiredEvidenceLayers: ["weather", "physical", "market"],
    indicatorSelectors: [
      approvedSelector(
        "usec-panama-rainfall-proxy",
        "regional_rainfall_panama_canal_catchment_v1",
        "weather",
        "supports",
        "NASA 点位等权流域降水代理，不是 ACP 水文或运营数值。",
      ),
    ],
    freshnessSlos: [approvedSlo("usec-panama-rainfall-proxy", 11520)],
    ...selectorPresentRules("usec", ["usec-panama-rainfall-proxy"], {
      support: ["水约束、通行能力与航线成本共同恶化", "ACP 与运价阈值待研究审核"],
      refute: ["吃水、槽位或等待时间改善", "ACP 数值尚未接入"],
      invalidate: ["ACP 撤销约束且运营恢复", "官方运营条件待研究审核"],
      relief: ["运河限制和航线压力持续缓解", "连续期数待研究审核"],
    }),
    stageGates: stageGatesFor("usec", {
      weather_realized: ["weather"],
      physical_pressure: ["weather", "physical"],
      balance_tightening: ["weather", "physical"],
      market_confirmed: ["weather", "physical", "market"],
      easing: ["weather", "physical"],
    }),
    directionPolicy: directionPolicyFor("usec"),
    confidencePolicy: APPROVED_CONFIDENCE_POLICY,
    materialChangeThresholds: EMPTY_PENDING_THRESHOLDS,
    templateCopy: {
      summary: "流域降水代理仅提供背景，尚无 ACP 数值和持牌航线指标支撑成本判断。",
      invalidation: "ACP 撤销约束并确认运营恢复后，才能按审核规则进入缓解。",
      coverageGap: "缺少 ACP 数值、亚洲—美东持牌运价与准班率。",
    },
    coverageGaps: [
      {
        id: "usec-acp-numeric",
        layer: "physical",
        description: "ACP 湖水位、槽位、吃水、等待时间等数值尚未接入。",
        blocks: ["stage", "confidence", "publication"],
      },
      {
        id: "usec-licensed-route-market",
        layer: "market",
        description: "亚洲—美东持牌即期运价与船期可靠性尚未接入。",
        blocks: ["stage", "confidence", "market_readiness", "publication"],
      },
    ],
    readiness: readinessFor(true, ["usec-acp-numeric", "usec-licensed-route-market"]),
  },
  {
    id: "SHIP-EU-01",
    slug: "asia-europe",
    title: "ENSO 相关因素对亚洲至欧洲航线是否存在可分离影响",
    category: "shipping",
    region: "asia-europe",
    marketScope: "SCFI 欧线、EC 与船期可靠性",
    methodologyVersion: "evaluation-v1-draft",
    regionDefinitionVersion: "asia-europe-v1",
    target: "亚洲至欧洲即期运价、EC 与船期可靠性",
    timeHorizon: "未来 1–8 周",
    defaultDirection: "mixed",
    requiredEvidenceLayers: ["weather", "market", "control"],
    indicatorSelectors: [
      approvedSelector(
        "eu-brent-control",
        "eia_europe_brent_spot_usd_per_bbl_daily",
        "control",
        "context",
        "EIA Brent 仅是广义燃料成本控制变量，不是船燃、附加费或航线运价。",
      ),
    ],
    freshnessSlos: [approvedSlo("eu-brent-control", 5760)],
    ...selectorPresentRules("eu", ["eu-brent-control"], {
      support: ["气候因素与航线市场变化可分离", "气候归因和运价阈值待研究审核"],
      refute: ["红海、运力或需求更能解释市场变化", "混杂因素来源尚未接入"],
      invalidate: ["无法从主要混杂因素中分离 ENSO 影响", "归因规则待研究审核"],
      relief: ["航线压力在控制变量下持续缓解", "缓解规则待研究审核"],
    }),
    stageGates: stageGatesFor("eu", {
      weather_realized: ["weather", "control"],
      physical_pressure: ["weather", "control"],
      balance_tightening: ["weather", "market", "control"],
      market_confirmed: ["weather", "market", "control"],
      easing: ["weather", "control"],
    }),
    directionPolicy: directionPolicyFor("eu"),
    confidencePolicy: APPROVED_CONFIDENCE_POLICY,
    materialChangeThresholds: EMPTY_PENDING_THRESHOLDS,
    templateCopy: {
      summary: "默认方向为分化/待验证；Brent 仅作控制，不能证明 ENSO 推动欧线运价。",
      invalidation: "若红海、运力或需求足以解释变化，则不得归因于 ENSO。",
      coverageGap: "缺少欧线持牌运价、准班率以及红海、运力和需求控制。",
    },
    coverageGaps: [
      {
        id: "eu-climate-attribution",
        layer: "weather",
        description: "可映射亚洲—欧洲货量的气候证据尚未接入。",
        blocks: ["stage", "confidence", "publication"],
      },
      {
        id: "eu-licensed-route-market",
        layer: "market",
        description: "欧线持牌即期运价、EC 和船期可靠性尚未接入。",
        blocks: ["stage", "confidence", "market_readiness", "publication"],
      },
      {
        id: "eu-red-sea-capacity-demand-controls",
        layer: "control",
        description: "红海/苏伊士、有效运力与需求控制尚未接入；Brent 不能替代这些变量。",
        blocks: ["stage", "confidence", "publication"],
      },
      {
        // 路径①（2026-09-24 负责人确认）的豁免锚点：该缺口使 SHIP-EU-01 无法产出方向证据，
        // 故允许在发布 brief 时被显式豁免并在公开页面如实展示（不用代理、不改数据）。
        id: "eu-route-market-unlicensed",
        layer: "market",
        description: "SCFI、FBX、Drewry 等欧线运价数据属商业授权来源，尚未接入；该论点暂无市场层方向证据。",
        blocks: ["confidence", "publication"],
      },
    ],
    readiness: readinessFor(false, [
      "eu-climate-attribution",
      "eu-licensed-route-market",
      "eu-red-sea-capacity-demand-controls",
      "eu-route-market-unlicensed",
    ]),
  },
] as const satisfies readonly ThesisSeed[];

export const INITIAL_THESIS_SEEDS = decodeThesisSeeds(initialThesisSeedDefinitions);
