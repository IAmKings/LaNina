import {
  PUBLIC_THESIS_CATEGORIES,
  type CategoryPageModel,
  type ChangesPageModel,
  type DataHealthPageModel,
  type IndicatorSeriesModel,
  type MethodologyPageModel,
  type OverviewPageModel,
  type PublicMarketCategory,
  type PublicThesisCategory,
  type ThesisCardModel,
  type ThesisPageModel,
} from "../../domain/page-models";

export const PUBLIC_INDICATOR_SERIES_POINT_LIMIT = 1_000;

export interface PublicIndicatorSeriesQuery {
  readonly indicatorId: string;
  readonly from: string;
  readonly to: string;
  readonly resolution: "raw";
}

/** The requested window is valid but contains more public points than this API may return. */
export class PublicIndicatorSeriesRangeError extends Error {
  constructor() {
    super("公开指标序列超过单次返回上限");
    this.name = "PublicIndicatorSeriesRangeError";
  }
}

/**
 * This remains raw-only until numerical aggregation rules are specified.
 * Canonical UTC values keep D1 range comparisons chronological.
 */
export function parsePublicIndicatorSeriesQuery(
  indicatorId: string,
  searchParams: URLSearchParams,
): PublicIndicatorSeriesQuery | null {
  if (!isPublicIndicatorId(indicatorId)) return null;
  const expectedKeys = new Set(["from", "to", "resolution"]);
  if ([...searchParams.keys()].some((key) => !expectedKeys.has(key))) return null;
  const from = singleSearchParameter(searchParams, "from");
  const to = singleSearchParameter(searchParams, "to");
  const resolution = singleSearchParameter(searchParams, "resolution");
  if (
    from === null
    || to === null
    || resolution !== "raw"
    || !isCanonicalUtc(from)
    || !isCanonicalUtc(to)
    || from > to
  ) return null;
  return { indicatorId, from, to, resolution };
}

function singleSearchParameter(searchParams: URLSearchParams, name: string): string | null {
  const values = searchParams.getAll(name);
  return values.length === 1 ? values[0] ?? null : null;
}

function isPublicIndicatorId(value: string): boolean {
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(value) && value.length <= 128;
}

export interface ChangesCursor {
  readonly detectedAt: string;
  readonly id: string;
}

export function parseChangesCursor(value: string | null): ChangesCursor | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.detectedAt !== "string" || typeof record.id !== "string") {
      return null;
    }
    if (!isCanonicalUtc(record.detectedAt) || record.id.trim().length === 0 || record.id.length > 256) return null;
    return { detectedAt: record.detectedAt, id: record.id };
  } catch {
    return null;
  }
}

/**
 * PRD §6.5 filters for the public change list. Filters narrow the change's own thesis
 * attribution, so a licence-compliant fact that is not attributed to a thesis only appears
 * when no category or thesis filter is applied.
 */
export interface PublicChangesQuery {
  readonly category: PublicThesisCategory | null;
  readonly thesisId: string | null;
  /** Inclusive lower bound on the detection time, canonical UTC. */
  readonly from: string | null;
  /** Inclusive upper bound on the detection time, canonical UTC. */
  readonly to: string | null;
}

export const EMPTY_PUBLIC_CHANGES_QUERY: PublicChangesQuery = Object.freeze({
  category: null,
  thesisId: null,
  from: null,
  to: null,
});

/** Returns null when any parameter is unknown, repeated or out of contract. */
export function parsePublicChangesQuery(searchParams: URLSearchParams): PublicChangesQuery | null {
  const expectedKeys = new Set(["cursor", "category", "thesis", "from", "to"]);
  if ([...searchParams.keys()].some((key) => !expectedKeys.has(key))) return null;

  const category = optionalSingleSearchParameter(searchParams, "category");
  const thesisId = optionalSingleSearchParameter(searchParams, "thesis");
  const from = optionalSingleSearchParameter(searchParams, "from");
  const to = optionalSingleSearchParameter(searchParams, "to");
  if (category === null || thesisId === null || from === null || to === null) return null;

  if (category !== undefined && !isPublicThesisCategory(category)) return null;
  if (thesisId !== undefined && !isPublicThesisId(thesisId)) return null;
  if (from !== undefined && !isCanonicalUtc(from)) return null;
  if (to !== undefined && !isCanonicalUtc(to)) return null;
  if (from !== undefined && to !== undefined && from > to) return null;

  return {
    category: category === undefined ? null : category,
    thesisId: thesisId ?? null,
    from: from ?? null,
    to: to ?? null,
  };
}

/** Absent means "no filter"; null means the parameter was repeated and the request is invalid. */
function optionalSingleSearchParameter(searchParams: URLSearchParams, name: string): string | undefined | null {
  const values = searchParams.getAll(name);
  if (values.length === 0) return undefined;
  return values.length === 1 && (values[0] ?? "").length > 0 ? values[0] : null;
}

function isPublicThesisCategory(value: string): value is PublicThesisCategory {
  return (PUBLIC_THESIS_CATEGORIES as readonly string[]).includes(value);
}

function isPublicThesisId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function isCanonicalUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

export interface PublicReadModelRepository {
  overview(generatedAt: string): Promise<OverviewPageModel>;
  theses(category: PublicThesisCategory | null, generatedAt: string): Promise<readonly ThesisCardModel[]>;
  indicatorSeries(query: PublicIndicatorSeriesQuery): Promise<IndicatorSeriesModel | null>;
  thesis(slug: string, generatedAt: string): Promise<ThesisPageModel | null>;
  category(category: PublicMarketCategory, generatedAt: string): Promise<CategoryPageModel | null>;
  changes(
    cursor: ChangesCursor | null,
    query: PublicChangesQuery,
    generatedAt: string,
  ): Promise<ChangesPageModel>;
  dataHealth(generatedAt: string): Promise<DataHealthPageModel>;
  methodology(generatedAt: string): Promise<MethodologyPageModel>;
}

/** Page-level public projection boundary; callers never receive database rows. */
export class PublicReadModelModule {
  constructor(private readonly repository: PublicReadModelRepository) {}

  overview(generatedAt: string): Promise<OverviewPageModel> {
    return this.repository.overview(generatedAt);
  }

  theses(category: PublicThesisCategory | null, generatedAt: string): Promise<readonly ThesisCardModel[]> {
    return this.repository.theses(category, generatedAt);
  }

  indicatorSeries(query: PublicIndicatorSeriesQuery): Promise<IndicatorSeriesModel | null> {
    return this.repository.indicatorSeries(query);
  }

  thesis(slug: string, generatedAt: string): Promise<ThesisPageModel | null> {
    return this.repository.thesis(slug, generatedAt);
  }

  category(category: PublicMarketCategory, generatedAt: string): Promise<CategoryPageModel | null> {
    return this.repository.category(category, generatedAt);
  }

  changes(
    cursor: ChangesCursor | null,
    query: PublicChangesQuery,
    generatedAt: string,
  ): Promise<ChangesPageModel> {
    return this.repository.changes(cursor, query, generatedAt);
  }

  dataHealth(generatedAt: string): Promise<DataHealthPageModel> {
    return this.repository.dataHealth(generatedAt);
  }

  methodology(generatedAt: string): Promise<MethodologyPageModel> {
    return this.repository.methodology(generatedAt);
  }
}
