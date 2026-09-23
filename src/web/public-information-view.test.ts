import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "../domain/page-models.fixtures";
import {
  categoryLabel,
  changesEndpoint,
  changesFilterFromSearch,
  changesFilterSummary,
  changesQueryString,
  changesSharePath,
  emptyChangesFilter,
  hasActiveChangesFilter,
  hasHealthWarning,
  hasPublishedMethodology,
  shanghaiDayBounds,
  successRateLabel,
} from "./public-information-view";

describe("public information view helpers", () => {
  it("marks any non-healthy public source as a visible warning", () => {
    expect(hasHealthWarning(PAGE_MODEL_FIXTURES.dataHealth)).toBe(false);
    expect(hasHealthWarning({
      ...PAGE_MODEL_FIXTURES.dataHealth,
      sources: [{ ...PAGE_MODEL_FIXTURES.dataHealth.sources[0]!, status: "stale" }],
    })).toBe(true);
  });

  it("keeps unavailable methodology distinct from a published version", () => {
    expect(hasPublishedMethodology(PAGE_MODEL_FIXTURES.methodology)).toBe(true);
    expect(hasPublishedMethodology({
      ...PAGE_MODEL_FIXTURES.methodology,
      methodologyVersion: "unavailable",
    })).toBe(false);
  });

  it("does not turn a missing success rate into zero", () => {
    expect(successRateLabel(100)).toBe("100%");
    expect(successRateLabel(97.5)).toBe("97.5%");
    expect(successRateLabel(null)).toBe("暂无足够运行记录");
  });
});

describe("public change filters", () => {
  it("reads only known filters from the address bar", () => {
    expect(changesFilterFromSearch("")).toEqual(emptyChangesFilter());
    expect(changesFilterFromSearch("?category=rubber&thesis=RUBBER-TH-01&from=2026-09-01&to=2026-09-10"))
      .toEqual({ category: "rubber", thesis: "RUBBER-TH-01", from: "2026-09-01", to: "2026-09-10" });
    expect(changesFilterFromSearch("?category=energy&thesis=-bad&from=2026-13-01"))
      .toEqual(emptyChangesFilter());
  });

  it("converts a Shanghai calendar day into canonical UTC bounds", () => {
    expect(shanghaiDayBounds("2026-09-10")).toEqual({
      from: "2026-09-09T16:00:00.000Z",
      to: "2026-09-10T15:59:59.999Z",
    });
    expect(shanghaiDayBounds("2026-02-30")).toBeNull();
    expect(shanghaiDayBounds("2026-9-10")).toBeNull();
  });

  it("builds the API query and the shareable path from the same filters", () => {
    expect(changesEndpoint(emptyChangesFilter())).toBe("/api/v1/changes");
    expect(changesEndpoint(
      { category: "rubber", thesis: "", from: "", to: "" },
      "cursor-token",
    )).toBe("/api/v1/changes?category=rubber&cursor=cursor-token");
    expect(changesSharePath({ category: "", thesis: "RUBBER-TH-01", from: "", to: "" }))
      .toBe("/changes?thesis=RUBBER-TH-01");
    expect(changesSharePath(emptyChangesFilter())).toBe("/changes");
  });

  it("drops an inverted or invalid day range instead of sending it", () => {
    expect(changesQueryString({ category: "", thesis: "", from: "2026-09-10", to: "2026-09-01" }))
      .toBe("");
    expect(changesQueryString({ category: "", thesis: "", from: "2026-09-10", to: "" }))
      .toBe(`from=${encodeURIComponent("2026-09-09T16:00:00.000Z")}`);
    expect(changesQueryString({ category: "", thesis: "", from: "", to: "2026-09-10" }))
      .toBe(`to=${encodeURIComponent("2026-09-10T15:59:59.999Z")}`);
  });

  it("summarises only active filters with readable labels", () => {
    expect(hasActiveChangesFilter(emptyChangesFilter())).toBe(false);
    expect(changesFilterSummary(emptyChangesFilter(), () => null)).toBeNull();
    expect(changesFilterSummary(
      { category: "rubber", thesis: "RUBBER-TH-01", from: "2026-09-01", to: "" },
      (thesisId) => thesisId === "RUBBER-TH-01" ? "泰国天然橡胶" : null,
    )).toBe("当前筛选：类别：天然橡胶 · 论点：泰国天然橡胶 · 起始日：2026-09-01");
    expect(changesFilterSummary(
      { category: "shipping", thesis: "SHIP-EU-01", from: "", to: "" },
      () => null,
    )).toContain("SHIP-EU-01");
    expect(categoryLabel("climate")).toBe("气候");
    expect(categoryLabel("unknown")).toBe("unknown");
  });
});
