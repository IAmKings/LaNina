import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "../domain/page-models.fixtures";
import { categoryEyebrow, categoryRequestPath, hasPublishedCategory } from "./category-view";

describe("category view helpers", () => {
  it("uses stable labels for every supported market category", () => {
    expect(categoryEyebrow("rubber")).toBe("Natural rubber");
    expect(categoryEyebrow("agriculture")).toBe("Agriculture");
    expect(categoryEyebrow("shipping")).toBe("Shipping");
  });

  it("does not turn an empty public projection into a populated category", () => {
    expect(hasPublishedCategory(PAGE_MODEL_FIXTURES.category)).toBe(true);
    expect(hasPublishedCategory({ ...PAGE_MODEL_FIXTURES.category, theses: [] })).toBe(false);
  });

  it("keeps each category selection scoped to its own public Read Model route", () => {
    expect(categoryRequestPath("rubber")).toBe("/api/v1/categories/rubber");
    expect(categoryRequestPath("agriculture")).toBe("/api/v1/categories/agriculture");
    expect(categoryRequestPath("shipping")).toBe("/api/v1/categories/shipping");
  });
});
