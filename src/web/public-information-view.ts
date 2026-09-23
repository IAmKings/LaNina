import type { DataHealthPageModel, MethodologyPageModel } from "../domain/page-models";

export function hasHealthWarning(model: DataHealthPageModel): boolean {
  return model.sources.some((source) => source.status !== "healthy");
}

export function hasPublishedMethodology(model: MethodologyPageModel): boolean {
  return model.methodologyVersion !== "unavailable";
}

export function successRateLabel(rate: number | null): string {
  return rate === null ? "暂无足够运行记录" : `${rate.toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * PRD §6.5 filters. Dates are Asia/Shanghai calendar days because that is the time zone every
 * published timestamp is rendered in; the API receives canonical UTC instants.
 */
export interface ChangesFilterState {
  readonly category: string;
  readonly thesis: string;
  readonly from: string;
  readonly to: string;
}

export const CHANGES_FILTER_CATEGORIES = ["climate", "rubber", "agriculture", "shipping"] as const;

export function emptyChangesFilter(): ChangesFilterState {
  return { category: "", thesis: "", from: "", to: "" };
}

/** Unknown or malformed parameters are ignored rather than forwarded to the API. */
export function changesFilterFromSearch(search: string): ChangesFilterState {
  const params = new URLSearchParams(search);
  const category = params.get("category") ?? "";
  const thesis = params.get("thesis") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return {
    category: (CHANGES_FILTER_CATEGORIES as readonly string[]).includes(category) ? category : "",
    thesis: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(thesis) ? thesis : "",
    from: isCalendarDate(from) ? from : "",
    to: isCalendarDate(to) ? to : "",
  };
}

/** Shanghai has no daylight saving time, so a day is a fixed +08:00 window. */
export function shanghaiDayBounds(date: string): { readonly from: string; readonly to: string } | null {
  if (!isCalendarDate(date)) return null;
  const from = new Date(`${date}T00:00:00.000+08:00`);
  const to = new Date(`${date}T23:59:59.999+08:00`);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

export function hasActiveChangesFilter(filters: ChangesFilterState): boolean {
  return filters.category !== "" || filters.thesis !== "" || filters.from !== "" || filters.to !== "";
}

/**
 * Builds the public query string for the change list. An inverted or invalid day range is dropped
 * instead of being sent to the API, which would reject it.
 */
export function changesQueryString(
  filters: ChangesFilterState,
  cursor: string | null = null,
): string {
  const params = new URLSearchParams();
  if (filters.category !== "") params.set("category", filters.category);
  if (filters.thesis !== "") params.set("thesis", filters.thesis);
  const from = filters.from === "" ? null : shanghaiDayBounds(filters.from);
  const to = filters.to === "" ? null : shanghaiDayBounds(filters.to);
  if (from !== null && to !== null) {
    if (from.from <= to.to) {
      params.set("from", from.from);
      params.set("to", to.to);
    }
  } else {
    if (from !== null) params.set("from", from.from);
    if (to !== null) params.set("to", to.to);
  }
  if (cursor !== null) params.set("cursor", cursor);
  return params.toString();
}

export function changesEndpoint(filters: ChangesFilterState, cursor: string | null = null): string {
  const query = changesQueryString(filters, cursor);
  return query === "" ? "/api/v1/changes" : `/api/v1/changes?${query}`;
}

/** Shareable URL for the current filter selection, without a pagination cursor. */
export function changesSharePath(filters: ChangesFilterState): string {
  const query = changesQueryString(filters);
  return query === "" ? "/changes" : `/changes?${query}`;
}

export function changesFilterSummary(
  filters: ChangesFilterState,
  thesisTitle: (thesisId: string) => string | null,
): string | null {
  if (!hasActiveChangesFilter(filters)) return null;
  const parts: string[] = [];
  if (filters.category !== "") parts.push(`类别：${categoryLabel(filters.category)}`);
  if (filters.thesis !== "") parts.push(`论点：${thesisTitle(filters.thesis) ?? filters.thesis}`);
  if (filters.from !== "") parts.push(`起始日：${filters.from}`);
  if (filters.to !== "") parts.push(`结束日：${filters.to}`);
  return `当前筛选：${parts.join(" · ")}`;
}

export function categoryLabel(category: string): string {
  if (category === "climate") return "气候";
  if (category === "rubber") return "天然橡胶";
  if (category === "agriculture") return "农产品";
  if (category === "shipping") return "航运";
  return category;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
