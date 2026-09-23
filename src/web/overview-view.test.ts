import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "../domain/page-models.fixtures";
import type { OverviewPageModel, ThesisCardModel } from "../domain/page-models";
import { OverviewContent } from "./App";
import {
  RISK_MAP_STAGES,
  directionLabel,
  formatShanghaiTime,
  freshnessLabel,
  hasPublicOverview,
  healthLabel,
  riskMapEmptyStageLabel,
  riskMapRows,
  stageLabel,
} from "./overview-view";

describe("overview view helpers", () => {
  it("translates published enums into Chinese labels", () => {
    expect(directionLabel("bullish")).toBe("偏多");
    expect(stageLabel("physical_pressure")).toBe("实物承压");
    expect(healthLabel("delayed")).toBe("延迟");
  });

  it("formats public timestamps for Shanghai users", () => {
    expect(formatShanghaiTime("2026-09-09T23:00:00.000Z")).toContain("2026/09/10");
    expect(formatShanghaiTime(null)).toBe("暂无");
  });

  it("keeps an empty publication distinct from a stale published overview", () => {
    expect(hasPublicOverview({ ...PAGE_MODEL_FIXTURES.overview, dailyBrief: null, theses: [] })).toBe(false);
    expect(hasPublicOverview(PAGE_MODEL_FIXTURES.staleOverview)).toBe(true);
  });

  it("groups the six theses by transmission stage without aggregating them", () => {
    const rows = riskMapRows(publishedOverview());

    expect(rows.map((row) => row.stage)).toEqual([...RISK_MAP_STAGES]);
    expect(rows.flatMap((row) => row.theses)).toHaveLength(6);
    // Every thesis appears exactly once, and a direction or confidence is never merged away.
    expect(new Set(rows.flatMap((row) => row.theses.map((thesis) => thesis.id))).size).toBe(6);
    for (const row of rows) {
      expect(row.stageLabel).toBe(stageLabel(row.stage));
      for (const thesis of row.theses) {
        expect(thesis.directionLabel).toBe(directionLabel(thesis.direction));
        expect(typeof thesis.confidence).toBe("number");
      }
    }
    // A stage nobody has reached stays visible as an explicit empty row.
    const withoutOneStage = {
      ...publishedOverview(),
      theses: publishedOverview().theses.slice(1),
    };
    expect(riskMapRows(withoutOneStage).some((row) => row.theses.length === 0)).toBe(true);
    expect(riskMapEmptyStageLabel()).toBe("暂无处于该阶段的判断");
    expect(freshnessLabel("stale")).toBe("延迟");
    expect(freshnessLabel("current")).toBe("正常");
  });

  it("renders the cross-market risk map with all six stages and no single score", () => {
    const html = renderToStaticMarkup(createElement(OverviewContent, {
      overview: { status: "ready", data: publishedOverview() },
    }));

    expect(html).toContain('id="risk-map-heading"');
    expect(html).toContain("不是评分，不合并为单一结论");
    for (const stage of RISK_MAP_STAGES) {
      expect(html).toContain(stageLabel(stage));
    }
    expect(html).toContain("阶段表示证据链推进到哪一层，不表示价格方向强度");
    expect(html).toContain("<caption>按传导阶段排列的六条影响论点");
  });
});

describe("overview presentation", () => {
  it("renders the published decision, three changes, and all six public thesis cards from one ready model", () => {
    const model = publishedOverview();
    const html = renderToStaticMarkup(createElement(OverviewContent, {
      overview: { status: "ready", data: model },
    }));

    expect(html).toContain("ENSO 已进入跨市场影响观察窗口");
    expect(html).toContain("数据截止");
    expect(html).toContain("2026/09/10 06:30");

    const changeList = /<ol class="changes-list">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";
    expect(changeList.match(/<li>/g)).toHaveLength(3);
    for (const change of model.topChanges) {
      expect(changeList).toContain(change.summary);
    }

    const cards = [...html.matchAll(/<article class="thesis-card">([\s\S]*?)<\/article>/g)].map((match) => match[1]);
    expect(cards).toHaveLength(6);
    expect(new Set(model.theses.map((thesis) => `/theses/${thesis.slug}`))).toHaveLength(6);
    for (const [index, thesis] of model.theses.entries()) {
      const card = cards[index] ?? "";
      expect(card).toContain(`<a href="/theses/${thesis.slug}">${thesis.title}</a>`);
      expect(card).toContain(directionLabel(thesis.direction));
      expect(card).toContain(stageLabel(thesis.stage));
      expect(card).toContain(`置信度 ${thesis.confidence}`);
    }
  });

  it("keeps the explicit empty and stale-publication states instead of inventing cards", () => {
    const emptyHtml = renderToStaticMarkup(createElement(OverviewContent, {
      overview: {
        status: "ready",
        data: { ...publishedOverview(), dailyBrief: null, theses: [] },
      },
    }));
    const staleHtml = renderToStaticMarkup(createElement(OverviewContent, {
      overview: {
        status: "ready",
        data: { ...publishedOverview(), freshness: "stale" },
      },
    }));

    expect(emptyHtml).toContain("暂无已发布的市场判定。");
    expect(emptyHtml).not.toContain("thesis-card");
    expect(staleHtml).toContain("数据延迟：");
    expect(staleHtml).toContain("ENSO 已进入跨市场影响观察窗口");
  });
});

function publishedOverview(): OverviewPageModel {
  const theses: readonly ThesisCardModel[] = [
    thesis("enso-window", "ENSO 跨市场影响窗口", "climate", "neutral", "watch", 61),
    thesis("thailand-rubber", "泰国天然橡胶", "rubber", "bullish", "physical_pressure", 72),
    thesis("indonesia-palm", "印尼棕榈油", "agriculture", "bullish", "weather_realized", 68),
    thesis("southern-africa-corn", "南部非洲玉米", "agriculture", "bearish", "balance_tightening", 64),
    thesis("asia-us-east", "亚洲—美东航线", "shipping", "mixed", "market_confirmed", 57),
    thesis("asia-europe", "亚洲—欧洲航线", "shipping", "bearish", "easing", 53),
  ];

  return {
    methodologyVersion: "evaluation-v1",
    dailyBrief: {
      briefDate: "2026-09-10",
      headline: "ENSO 已进入跨市场影响观察窗口",
      summary: "六条公开论点依据同一已发布研究快照更新。",
      dataCutoff: "2026-09-09T22:30:00.000Z",
      publishedAt: "2026-09-09T23:00:00.000Z",
    },
    enso: theses[0],
    topChanges: [
      publicChange("change-1", "泰南降水观测已修订。"),
      publicChange("change-2", "棕榈油产区降水窗口更新。"),
      publicChange("change-3", "欧洲航线风险溢价回落。"),
    ],
    theses,
    sourceHealth: { healthy: 5, delayed: 1, stale: 0, broken: 0 },
    freshness: "current",
  };
}

function thesis(
  slug: string,
  title: string,
  category: ThesisCardModel["category"],
  direction: ThesisCardModel["direction"],
  stage: ThesisCardModel["stage"],
  confidence: number,
): ThesisCardModel {
  return {
    id: `thesis-${slug}`,
    slug,
    title,
    category,
    region: "公开研究区域",
    marketScope: "公开市场范围",
    timeHorizon: "未来 1–3 个月",
    direction,
    stage,
    confidence,
    summary: `${title}的已发布公开摘要。`,
    latestEvidenceSummary: "已发布的最新证据。",
    freshness: "current",
    basedOnCutoff: "2026-09-09T22:30:00.000Z",
    publishedAt: "2026-09-09T23:00:00.000Z",
    version: 1,
  };
}

function publicChange(id: string, summary: string): OverviewPageModel["topChanges"][number] {
  return {
    id,
    type: "thesis",
    thesisId: null,
    thesisTitle: null,
    summary,
    beforeLabel: null,
    afterLabel: "已发布",
    detectedAt: "2026-09-09T22:10:00.000Z",
    publishedInCurrentThesis: true,
    source: null,
  };
}
