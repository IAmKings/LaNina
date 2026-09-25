import type {
  AdminDraftPageModel,
  AdminRunsPageModel,
  CategoryPageModel,
  ChangesPageModel,
  DataHealthPageModel,
  MethodologyPageModel,
  OverviewPageModel,
  PageLoadState,
  ThesisPageModel,
} from "./page-models";

const SOURCE = {
  name: "NOAA Climate Prediction Center",
  organization: "NOAA",
  citationUrl: "https://www.cpc.ncep.noaa.gov/",
} as const;

const TIMES = {
  observedAt: "2026-09-09T00:00:00.000Z",
  publishedAt: "2026-09-09T12:00:00.000Z",
  fetchedAt: "2026-09-09T12:05:00.000Z",
} as const;

const ENSO_CARD = {
  id: "ENSO-CORE-01",
  slug: "enso-core",
  title: "ENSO 强度与持续时间",
  category: "climate",
  region: "热带太平洋",
  marketScope: "RONI/ONI 与区域风险窗口",
  timeHorizon: "未来 1–3 个月",
  direction: "neutral",
  stage: "watch",
  confidence: 61,
  summary: "当前信号仍处于观察阶段，等待区域天气与实物层交叉确认。",
  latestEvidenceSummary: "NOAA 更新了 RONI 诊断。",
  freshness: "current",
  basedOnCutoff: "2026-09-09T22:30:00.000Z",
  publishedAt: "2026-09-09T23:00:00.000Z",
  version: 2,
} as const;

const RUBBER_CARD = {
  id: "RUBBER-TH-01",
  slug: "thailand-rubber",
  title: "泰国天然橡胶",
  category: "rubber",
  region: "泰国南部主产区",
  marketScope: "RU、NR、TSR20、RSS3",
  timeHorizon: "未来 2–8 周",
  direction: "bullish",
  stage: "physical_pressure",
  confidence: 72,
  summary: "区域天气与实物供应共同指向短期原料压力。",
  latestEvidenceSummary: "近期降水异常仍在影响割胶窗口。",
  freshness: "current",
  basedOnCutoff: "2026-09-09T22:30:00.000Z",
  publishedAt: "2026-09-09T23:00:00.000Z",
  version: 3,
} as const;

interface PageModelFixtures {
  overview: OverviewPageModel;
  staleOverview: OverviewPageModel;
  thesis: ThesisPageModel;
  category: CategoryPageModel;
  emptyChanges: ChangesPageModel;
  dataHealth: DataHealthPageModel;
  methodology: MethodologyPageModel;
  adminRuns: AdminRunsPageModel;
  adminDraft: AdminDraftPageModel;
  states: {
    loading: PageLoadState<OverviewPageModel>;
    ready: PageLoadState<OverviewPageModel>;
    empty: PageLoadState<ChangesPageModel>;
    error: PageLoadState<OverviewPageModel>;
  };
}

const fixtures: PageModelFixtures = {
  overview: {
    methodologyVersion: "evaluation-v1-draft",
    dailyBrief: {
      briefDate: "2026-09-10",
      headline: "ENSO 风险仍待实物与市场层确认",
      summary: "今日更新保留了支持和反向证据，未把单一价格变化视为市场确认。",
      dataCutoff: "2026-09-09T22:30:00.000Z",
      publishedAt: "2026-09-09T23:00:00.000Z",
    },
    enso: ENSO_CARD,
    topChanges: [{
      id: "change-rubber-weather-r1",
      type: "revision",
      thesisId: "RUBBER-TH-01",
      thesisTitle: "泰国天然橡胶",
      summary: "区域降水观测已修订。",
      beforeLabel: "-12%",
      afterLabel: "-18%",
      detectedAt: "2026-09-09T22:10:00.000Z",
      publishedInCurrentThesis: true,
      source: SOURCE,
    }],
    theses: [ENSO_CARD, RUBBER_CARD],
    coverageGaps: [{
      thesisId: "SHIP-EU-01",
      title: "欧线航运市场确认",
      gapDescription: "SCFI、FBX、Drewry 等欧线运价数据属商业授权来源，尚未接入。",
    }],
    sourceHealth: { healthy: 2, delayed: 0, stale: 0, broken: 0 },
    freshness: "current",
  },
  staleOverview: {
    methodologyVersion: "unavailable",
    dailyBrief: null,
    enso: ENSO_CARD,
    topChanges: [],
    theses: [{ ...RUBBER_CARD, freshness: "stale" }],
    coverageGaps: [],
    sourceHealth: { healthy: 0, delayed: 0, stale: 1, broken: 1 },
    freshness: "stale",
  },
  thesis: {
    thesis: RUBBER_CARD,
    invalidation: "主产区降水恢复且原料供应改善、库存连续两期上升。",
    supportingEvidence: [{
      summary: "泰南降水异常扩大了割胶窗口的不确定性。",
      layer: "weather",
      stance: "supports",
      source: SOURCE,
      times: TIMES,
      quality: "verified",
      revision: 0,
      valueLabel: "降水异常 -18%",
    }],
    counterEvidence: [{
      summary: "库存尚未显示持续性下降。",
      layer: "balance",
      stance: "refutes",
      source: SOURCE,
      times: { ...TIMES, observedAt: null },
      quality: "provisional",
      revision: 1,
      valueLabel: null,
    }],
    indicators: [{
      id: "thai-rain-anomaly",
      name: "泰南降水异常",
      unit: "%",
      points: [{
        observedAt: "2026-09-08T00:00:00.000Z",
        value: -18,
        unit: "%",
        quality: "provisional",
        revision: 1,
        isRevision: true,
        source: SOURCE,
        times: TIMES,
      }],
      missingReason: null,
    }],
    versions: [{
      version: 3,
      direction: "bullish",
      stage: "physical_pressure",
      confidence: 72,
      summary: "区域天气与实物供应共同指向短期原料压力。",
      publishedAt: "2026-09-09T23:00:00.000Z",
      changeReason: "区域观测修订后进入实物受压阶段。",
    }],
    freshness: "current",
  },
  category: {
    category: "rubber",
    title: "天然橡胶",
    summary: "聚合展示泰国天气、原料供应和市场确认链条。",
    theses: [RUBBER_CARD],
    changes: [],
    coverageGaps: ["缺少可公开再分发的橡胶现货价格序列。"],
    freshness: "current",
  },
  emptyChanges: { changes: [], nextCursor: null, freshness: "current" },
  dataHealth: {
    sources: [{
      sourceId: "noaa_cpc_roni",
      name: SOURCE.name,
      organization: SOURCE.organization,
      homepageUrl: SOURCE.citationUrl,
      status: "healthy",
      cadenceMinutes: 60,
      lastSuccessAt: "2026-09-09T12:05:00.000Z",
      lastFetchedAt: "2026-09-09T12:05:00.000Z",
      sevenDaySuccessRate: 100,
      affectedIndicators: ["RONI"],
      affectedTheses: ["ENSO-CORE-01"],
    }],
    generatedAt: "2026-09-09T23:00:00.000Z",
  },
  methodology: {
    methodologyVersion: "evaluation-v1-draft",
    lastUpdatedAt: "2026-09-09T23:00:00.000Z",
    sections: [{
      id: "confidence",
      title: "置信度",
      summary: "置信度描述证据质量，不代表价格方向概率或交易胜率。",
    }],
    coverageGaps: [],
  },
  adminRuns: {
    actor: { email: "researcher@example.test", roles: ["viewer", "editor"] },
    runs: [{
      id: "run-noaa-1",
      sourceId: "noaa_cpc_roni",
      sourceName: SOURCE.name,
      scheduledAt: "2026-09-09T12:00:00.000Z",
      finishedAt: "2026-09-09T12:05:00.000Z",
      status: "success",
      observationsInserted: 1,
      observationsRevised: 0,
      safeErrorCode: null,
    }],
    nextCursor: null,
  },
  adminDraft: {
    actor: { email: "publisher@example.test", roles: ["publisher"] },
    thesis: { id: RUBBER_CARD.id, title: RUBBER_CARD.title, currentPublishedVersion: 2 },
    published: {
      id: "rubber-version-2",
      version: 2,
      direction: RUBBER_CARD.direction,
      stage: RUBBER_CARD.stage,
      confidence: 62,
      summary: "此前已发布版本：产区天气风险对原料供应形成支撑。",
      invalidation: "主产区降水恢复且原料供应改善、库存连续两期上升。",
      basedOnCutoff: "2026-09-08T22:30:00.000Z",
      createdAt: "2026-09-08T22:35:00.000Z",
      changeReason: "初始发布。",
    },
    draft: {
      id: "rubber-version-3",
      version: 3,
      direction: RUBBER_CARD.direction,
      stage: RUBBER_CARD.stage,
      confidence: RUBBER_CARD.confidence,
      summary: RUBBER_CARD.summary,
      invalidation: "主产区降水恢复且原料供应改善、库存连续两期上升。",
      basedOnCutoff: RUBBER_CARD.basedOnCutoff,
      createdAt: "2026-09-09T22:35:00.000Z",
      changeReason: "区域观测修订。",
    },
  },
  states: {
    loading: { status: "loading" },
    ready: { status: "ready", data: undefined as never },
    empty: { status: "empty", data: undefined as never },
    error: { status: "error", message: "暂时无法载入公开判定，请稍后重试。" },
  },
};

fixtures.states.ready = { status: "ready", data: fixtures.overview };
fixtures.states.empty = { status: "empty", data: fixtures.emptyChanges };

export const PAGE_MODEL_FIXTURES: Readonly<PageModelFixtures> = Object.freeze(fixtures);
