import type { CategoryPageModel } from "../domain/page-models";

export function categoryRequestPath(category: CategoryPageModel["category"]): string {
  return `/api/v1/categories/${encodeURIComponent(category)}`;
}

export function hasPublishedCategory(model: CategoryPageModel): boolean {
  return model.theses.length > 0;
}

export function categoryEyebrow(category: CategoryPageModel["category"]): string {
  const labels: Record<CategoryPageModel["category"], string> = {
    rubber: "Natural rubber",
    agriculture: "Agriculture",
    shipping: "Shipping",
  };

  return labels[category];
}
