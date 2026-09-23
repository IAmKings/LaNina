/**
 * LOCAL DEMO ONLY — synthetic read models for `vite --mode demo`.
 *
 * This module exists so the local demo server can answer every public read path with content,
 * instead of leaving `/agriculture`, `/shipping`, the thesis list and the Atom feed empty while the
 * other paths return fixtures. Nothing here is research output, published data or a market fact:
 *
 * - It is imported **only** by `vite.config.ts` for the demo middleware; it is never part of the
 *   client bundle or the Worker. `src/domain/local-demo-fixtures.test.ts` fails if app code imports it.
 * - Every response built from it carries `x-enso-local-demo: synthetic-published-read-model` and
 *   `methodologyVersion: "synthetic-local-demo-v1"`.
 * - Direction, stage and confidence values below are invented placeholders chosen to spread the six
 *   theses across the transmission stages so the cross-market map is legible. They are not judgments.
 *
 * Real content requires the documented release path (research sign-off, source licensing and a
 * staging environment); see `docs/operations/external-authorization-requests.md`.
 */
import { PAGE_MODEL_FIXTURES } from "./page-models.fixtures";
import type {
  AtomFeedModel,
} from "./atom-feed";
import type {
  CategoryPageModel,
  PublicMarketCategory,
  PublicThesisCategory,
  ThesisCardModel,
  ThesisPageModel,
} from "./page-models";

interface DemoSyntheticThesis {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly category: PublicThesisCategory;
  readonly region: string;
  readonly marketScope: string;
  readonly timeHorizon: string;
  readonly direction: ThesisCardModel["direction"];
  readonly stage: ThesisCardModel["stage"];
  readonly confidence: number;
  readonly summary: string;
  readonly latestEvidenceSummary: string;
  readonly invalidation: string;
  readonly supportSummary: string;
  readonly counterSummary: string;
  readonly indicatorName: string;
}

/** Four invented cards covering the theses the shipped fixtures do not model. */
const SYNTHETIC_THESES: readonly DemoSyntheticThesis[] = [
  {
    id: "PALM-SEA-01",
    slug: "southeast-asia-palm-oil",
    title: "东南亚棕榈油",
    category: "agriculture",
    region: "印尼与马来西亚主产区",
    marketScope: "毛棕榈油与出口政策",
    timeHorizon: "未来 1–3 个月",
    direction: "bullish",
    stage: "weather_realized",
    confidence: 58,
    summary: "合成演示：产区水分压力已被区域观测证实，实物产量尚未确认。",
    latestEvidenceSummary: "合成演示：区域降水距平转为负值。",
    invalidation: "合成演示：产区降水恢复正常且库存连续两期回升。",
    supportSummary: "合成演示：主产区降水低于同期均值。",
    counterSummary: "合成演示：出口配额尚未收紧。",
    indicatorName: "合成演示：产区降水距平",
  },
  {
    id: "MAIZE-SA-01",
    slug: "southern-africa-maize",
    title: "南部非洲玉米",
    category: "agriculture",
    region: "南部非洲主种植带",
    marketScope: "玉米现货与期末库存",
    timeHorizon: "下一作物年度",
    direction: "mixed",
    stage: "watch",
    confidence: 44,
    summary: "合成演示：种植季前的信号尚不足以支持方向判断。",
    latestEvidenceSummary: "合成演示：月度估计维持不变。",
    invalidation: "合成演示：种植季降水回到常年区间。",
    supportSummary: "合成演示：种植带土壤湿度偏低。",
    counterSummary: "合成演示：上一年度结转库存充足。",
    indicatorName: "合成演示：种植带降水距平",
  },
  {
    id: "SHIP-USEC-01",
    slug: "asia-us-east",
    title: "亚洲—美东航线",
    category: "shipping",
    region: "巴拿马运河与美东港口",
    marketScope: "集装箱运价与准班率",
    timeHorizon: "未来 2–8 周",
    direction: "bearish",
    stage: "balance_tightening",
    confidence: 66,
    summary: "合成演示：通行限制叠加可用运力下降，供需正在收紧。",
    latestEvidenceSummary: "合成演示：每日通行槽位维持低位。",
    invalidation: "合成演示：通行槽位恢复且等待时间回到常态。",
    supportSummary: "合成演示：通行槽位低于同期。",
    counterSummary: "合成演示：替代路径运力有所增加。",
    indicatorName: "合成演示：每日通行槽位",
  },
  {
    id: "SHIP-EU-01",
    slug: "asia-europe",
    title: "亚洲—欧洲航线",
    category: "shipping",
    region: "红海—苏伊士与北欧港口",
    marketScope: "集装箱运价与运力",
    timeHorizon: "未来 2–8 周",
    direction: "mixed",
    stage: "market_confirmed",
    confidence: 53,
    summary: "合成演示：市场已出现变化，但气候因素与其他扰动无法分离。",
    latestEvidenceSummary: "合成演示：绕行比例上升。",
    invalidation: "合成演示：绕行比例回落且运价回到事件前区间。",
    supportSummary: "合成演示：绕行比例上升。",
    counterSummary: "合成演示：需求走弱同时压制运价。",
    indicatorName: "合成演示：绕行比例",
  },
];

function syntheticCard(thesis: DemoSyntheticThesis): ThesisCardModel {
  const base = PAGE_MODEL_FIXTURES.thesis.thesis;
  return {
    ...base,
    id: thesis.id,
    slug: thesis.slug,
    title: thesis.title,
    category: thesis.category,
    region: thesis.region,
    marketScope: thesis.marketScope,
    timeHorizon: thesis.timeHorizon,
    direction: thesis.direction,
    stage: thesis.stage,
    confidence: thesis.confidence,
    summary: thesis.summary,
    latestEvidenceSummary: thesis.latestEvidenceSummary,
  };
}

const SYNTHETIC_CARDS = SYNTHETIC_THESES.map(syntheticCard);

/**
 * Public slugs come from the product seed (`seeds/0001_theses.sql`). The shipped fixtures use a
 * shorter rubber slug, so the demo normalizes it and the local demo matches what the real local
 * database serves under `npm run db:seed:local-demo`.
 */
const PRODUCT_SLUGS: Readonly<Record<string, string>> = Object.freeze({
  "ENSO-CORE-01": "enso-core",
  "RUBBER-TH-01": "thailand-natural-rubber",
});

/**
 * All six public theses in stable product order: the two shipped fixture cards plus four synthetic
 * ones, so the homepage risk map, the thesis list and the change filters all have real coverage.
 */
export function demoThesisCards(): readonly ThesisCardModel[] {
  return [
    PAGE_MODEL_FIXTURES.overview.theses[0]!,
    PAGE_MODEL_FIXTURES.overview.theses[1]!,
    ...SYNTHETIC_CARDS,
  ].map((card) => ({ ...card, slug: PRODUCT_SLUGS[card.id] ?? card.slug }));
}

const CATEGORY_COPY: Record<PublicMarketCategory, { title: string; summary: string; gaps: readonly string[] }> = {
  rubber: {
    title: "天然橡胶",
    summary: "聚合展示泰国天气、原料供应和市场确认链条。",
    gaps: ["合成演示：缺少可公开再分发的橡胶现货价格序列。"],
  },
  agriculture: {
    title: "农产品",
    summary: "聚合展示棕榈油与南部非洲玉米的天气、供需与市场确认链条。",
    gaps: [
      "合成演示：缺少可公开再分发的 MPOB 月度产量与库存序列。",
      "合成演示：USDA PSD 仅为营销年度估计，不能当作实物流。",
    ],
  },
  shipping: {
    title: "航运",
    summary: "聚合展示亚洲—美东与亚洲—欧洲航线的通行、运力与运价链条。",
    gaps: [
      "合成演示：缺少可公开再分发的航线运价序列。",
      "合成演示：运价变化不能单独归因于 ENSO。",
    ],
  },
};

/** One category page per public market category, each populated instead of empty. */
export function demoCategoryPages(): readonly CategoryPageModel[] {
  const changes = PAGE_MODEL_FIXTURES.overview.topChanges;
  return (Object.keys(CATEGORY_COPY) as PublicMarketCategory[]).map((category) => {
    const copy = CATEGORY_COPY[category];
    return {
      ...PAGE_MODEL_FIXTURES.category,
      category,
      title: copy.title,
      summary: copy.summary,
      theses: demoThesisCards().filter((thesis) => thesis.category === category),
      changes,
      coverageGaps: copy.gaps,
      freshness: "current",
    };
  });
}

/** Detail pages for every demo card, so a category link never lands on an empty route. */
export function demoThesisPages(): readonly ThesisPageModel[] {
  const base = PAGE_MODEL_FIXTURES.thesis;
  const syntheticBySlug = new Map(SYNTHETIC_THESES.map((thesis) => [thesis.slug, thesis]));
  return demoThesisCards().map((card) => {
    const synthetic = syntheticBySlug.get(card.slug);
    if (synthetic === undefined) {
      // The two shipped fixture cards keep their shipped detail copy under the product slug.
      return { ...base, thesis: card };
    }
    return {
      ...base,
      thesis: card,
      invalidation: synthetic.invalidation,
      supportingEvidence: base.supportingEvidence.map((item) => ({ ...item, summary: synthetic.supportSummary })),
      counterEvidence: base.counterEvidence.map((item) => ({ ...item, summary: synthetic.counterSummary })),
      indicators: base.indicators.map((series) => ({ ...series, name: synthetic.indicatorName })),
    };
  });
}

/** A non-empty feed so `/feed.xml` shows entries rather than only a title. */
export function demoAtomFeed(): AtomFeedModel {
  const brief = PAGE_MODEL_FIXTURES.overview.dailyBrief;
  return {
    changes: PAGE_MODEL_FIXTURES.overview.topChanges,
    dailyBriefs: brief === null ? [] : [brief],
  };
}
