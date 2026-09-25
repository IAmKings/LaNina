import { reportStorageFailure } from "./storage-logging";
import { INITIAL_THESIS_SEEDS } from "../../../domain/initial-thesis-seeds";
import { coverageGapDescription } from "../../../domain/coverage-gaps";
import type { AtomDailyBriefModel, AtomFeedModel } from "../../../domain/atom-feed";
import type {
  CategoryPageModel,
  ChangesPageModel,
  DataHealthPageModel,
  DailyBriefPageModel,
  DailyBriefThesisModel,
  IndicatorPointModel,
  IndicatorSeriesModel,
  MethodologyPageModel,
  OverviewPageModel,
  PageFreshness,
  PublicCoverageGapModel,
  PublicMarketCategory,
  PublicSourceReference,
  PublicChangeModel,
  PublicThesisCategory,
  SourceHealthModel,
  ThesisCardModel,
  ThesisEvidenceModel,
  ThesisPageModel,
  ThesisVersionTimelineModel,
} from "../../../domain/page-models";
import { REQUIRED_DAILY_THESIS_IDS } from "../../../domain/daily-brief";
import { THESIS_DIRECTIONS, THESIS_STAGES } from "../../../domain/contracts";
import { SOURCE_ERROR_CODES, type SourceErrorCode, type SourceHealthStatus } from "../../../domain/ingestion";
import { calculateSourceHealth } from "../../ingestion/source-health";
import type { AtomFeedRepository } from "../../modules/atom-feed";
import type { PublicDailyBriefRepository } from "../../modules/public-daily-briefs";
import {
  EMPTY_PUBLIC_CHANGES_QUERY,
  PUBLIC_INDICATOR_SERIES_POINT_LIMIT,
  PublicIndicatorSeriesRangeError,
  type ChangesCursor,
  type PublicChangesQuery,
  type PublicIndicatorSeriesQuery,
  type PublicReadModelRepository,
} from "../../modules/read-models";

const OVERVIEW_STATEMENT_COUNT = 5;
const METHODOLOGY_STATEMENT_COUNT = 2;
const TOP_CHANGE_LIMIT = 3;
const THESIS_STATEMENT_COUNT = 5;
const PUBLIC_INDICATOR_LIMIT = 8;
const CATEGORY_STATEMENT_COUNT = 3;
const CATEGORY_CHANGE_LIMIT = 8;
const CHANGES_STATEMENT_COUNT = 2;
const PUBLIC_CHANGES_PAGE_SIZE = 20;
const FEED_CHANGE_LIMIT = 20;
const FEED_DAILY_BRIEF_LIMIT = 20;
const MAJOR_CHANGE_IMPORTANCE = 4;
const DAILY_BRIEF_STATEMENT_COUNT = 2;

const METHODOLOGY_SECTIONS: MethodologyPageModel["sections"] = [
  {
    id: "enso-indices",
    title: "RONI 与 ONI",
    summary: "RONI 和 ONI 是不同口径的 ENSO 指标。页面同时保留指标、基准期和数据状态，不把单一读数直接转为市场结论。",
  },
  {
    id: "transmission-stages",
    title: "传导阶段",
    summary: "研究按气候观察、区域天气兑现、实物受压、供需收紧、市场确认与缓解分层；阶段表示证据验证位置，不是交易信号。",
  },
  {
    id: "confidence",
    title: "置信度",
    summary: "置信度衡量证据覆盖、新鲜度、来源质量与一致性，不代表价格方向的概率或交易胜率。",
  },
  {
    id: "revisions-and-sources",
    title: "修订与来源",
    summary: "观测保留修订版本、来源发布时间与采集时间。仅在许可合规时公开事实，并同时展示支持和反向证据。",
  },
  {
    id: "limitations",
    title: "已知局限",
    summary: "ENSO、区域天气、实物供需和市场表现存在时滞与混杂因素；历史关系不保证未来结果，本站内容不构成投资建议。",
  },
] as const;

const CATEGORY_COPY: Record<PublicMarketCategory, {
  readonly title: string;
  readonly summary: string;
  readonly coverageGaps: readonly string[];
}> = {
  rubber: {
    title: "天然橡胶",
    summary: "跟踪主产区天气、原料供应、库存与市场确认之间的公开证据链。",
    coverageGaps: ["尚未接入可公开再分发的橡胶现货、库存与期限结构全量序列。"],
  },
  agriculture: {
    title: "农产品",
    summary: "跟踪产区天气、作物供给、贸易与价格确认之间的公开证据链。",
    coverageGaps: ["部分产区的高频现货、仓储和作物进度数据尚未具备可公开展示的许可。"],
  },
  shipping: {
    title: "航运",
    summary: "跟踪航道天气、港口与运力约束、货量及航线市场确认之间的公开证据链。",
    coverageGaps: ["美东与欧洲航线的完整运价、港口拥堵和班期数据尚未全部具备公开展示条件。"],
  },
};

export const OVERVIEW_PUBLISHED_THESES_QUERY = `SELECT thesis.id, thesis.slug, thesis.title, thesis.category, thesis.region,
                  thesis.market_scope, version.direction, version.stage, version.confidence,
                  version.summary, version.based_on_cutoff, version.published_at, version.version
             FROM thesis_publications publication
             JOIN theses thesis
               ON thesis.id = publication.thesis_id AND thesis.active = 1
             JOIN thesis_versions version
               ON version.id = publication.current_version_id
              AND version.thesis_id = thesis.id
              AND version.status = 'published'
            ORDER BY thesis.id`;

/**
 * 路径①（2026-09-24）：最新已发布每日判定显式豁免的覆盖缺口。
 *
 * 被豁免论点没有已发布版本，因此它既不会出现在 `theses` 卡片里，也不能伪造方向或置信度；
 * 这里只把"数据覆盖不足"的缺口如实投影到公开页面。
 */
export const LATEST_DAILY_BRIEF_COVERAGE_GAPS_QUERY = `SELECT exemption.thesis_id, exemption.gap_id, thesis.title
   FROM daily_brief_exemptions exemption
   JOIN theses thesis ON thesis.id = exemption.thesis_id
  WHERE exemption.brief_date = (
    SELECT brief.brief_date FROM daily_briefs brief
     WHERE brief.status = 'published'
     ORDER BY brief.brief_date DESC
     LIMIT 1
  )
  ORDER BY exemption.thesis_id`;

/**
 * The query-plan regression imports this exact projection so a later query
 * rewrite cannot silently lose the bounded observations index access.
 */
export const PUBLIC_INDICATOR_SERIES_QUERY = `SELECT indicator.id, indicator.name, indicator.unit AS indicator_unit,
        source.name AS source_name, source.organization AS source_organization,
        observation.observed_at, observation.value_num, observation.value_text,
        observation.unit AS observation_unit, observation.quality, observation.revision,
        observation.citation_url, observation.published_at, observation.fetched_at
   FROM indicators indicator
   JOIN sources source
     ON source.id = indicator.source_id
    AND source.redistribution IN ('allowed', 'derived_only')
   LEFT JOIN observations observation
     ON observation.indicator_id = indicator.id
    AND observation.quality <> 'invalid'
    AND observation.observed_at >= ?
    AND observation.observed_at <= ?
  WHERE indicator.id = ? AND indicator.public = 1
  ORDER BY observation.observed_at, observation.revision
  LIMIT ?`;

export const CURRENT_PUBLISHED_THESIS_QUERY = `SELECT thesis.id, thesis.slug, thesis.title, thesis.category, thesis.region,
            thesis.market_scope, version.direction, version.stage, version.confidence,
            version.summary, version.based_on_cutoff, version.published_at, version.version,
            version.invalidation
       FROM theses thesis
       JOIN thesis_publications publication
         ON publication.thesis_id = thesis.id
       JOIN thesis_versions version
         ON version.id = publication.current_version_id
        AND version.thesis_id = thesis.id
        AND version.status = 'published'
      WHERE thesis.slug = ? AND thesis.active = 1
      LIMIT 1`;

export const CATEGORY_PUBLISHED_THESES_QUERY = `SELECT thesis.id, thesis.slug, thesis.title, thesis.category, thesis.region,
                  thesis.market_scope, version.direction, version.stage, version.confidence,
                  version.summary, version.based_on_cutoff, version.published_at, version.version
             FROM theses thesis
             JOIN thesis_publications publication
               ON publication.thesis_id = thesis.id
             JOIN thesis_versions version
               ON version.id = publication.current_version_id
              AND version.thesis_id = thesis.id
              AND version.status = 'published'
            WHERE thesis.category = ? AND thesis.active = 1
            ORDER BY thesis.id`;

export const CATEGORY_PUBLISHED_CHANGES_QUERY = `SELECT change.id, change.change_type, change.thesis_id,
                  thesis.title AS thesis_title, change.detected_at
             FROM changes change
             JOIN theses thesis
               ON thesis.id = change.thesis_id
              AND thesis.category = ?
              AND thesis.active = 1
             JOIN thesis_publications publication
               ON publication.thesis_id = thesis.id
             JOIN thesis_versions version
               ON version.id = publication.current_version_id
              AND version.thesis_id = thesis.id
              AND version.status = 'published'
              AND change.published_version_id = version.id
            ORDER BY change.detected_at DESC, change.id DESC
            LIMIT ?`;

export class ReadModelStorageError extends Error {
  constructor() {
    super("公开读取模型数据无效");
    this.name = "ReadModelStorageError";
  }
}

export class D1PublicReadModelRepository implements PublicReadModelRepository {
  constructor(private readonly database: D1Database) {}

  async overview(generatedAt: string): Promise<OverviewPageModel> {
    assertCanonicalUtc(generatedAt);
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        this.database.prepare(
          `SELECT brief.brief_date, brief.headline, brief.summary, brief.data_cutoff, brief.published_at,
                  (SELECT link.methodology_version
                     FROM daily_brief_theses link
                    WHERE link.brief_date = brief.brief_date
                    ORDER BY link.sort_order
                    LIMIT 1) AS methodology_version
             FROM daily_briefs brief
            WHERE brief.status = 'published'
            ORDER BY brief.brief_date DESC
            LIMIT 1`,
        ),
        this.database.prepare(OVERVIEW_PUBLISHED_THESES_QUERY),
        this.database.prepare(
          `SELECT change.id, change.change_type, change.thesis_id, thesis.title AS thesis_title,
                  change.detected_at
             FROM changes change
             JOIN thesis_versions version
               ON version.id = change.published_version_id AND version.status = 'published'
             LEFT JOIN theses thesis ON thesis.id = change.thesis_id
            ORDER BY change.detected_at DESC, change.id DESC
            LIMIT ?`,
        ).bind(TOP_CHANGE_LIMIT),
        this.database.prepare(
          `SELECT source.id, source.last_success_at, source.late_after_minutes,
                  source.stale_after_minutes, source.consecutive_failures, source.last_error_code
             FROM sources source
            WHERE source.enabled = 1
            ORDER BY source.id`,
        ),
        this.database.prepare(LATEST_DAILY_BRIEF_COVERAGE_GAPS_QUERY),
      ]);
      if (!Array.isArray(results) || results.length !== OVERVIEW_STATEMENT_COUNT) throw new ReadModelStorageError();
      const briefRows = rows(results[0]);
      const thesisRows = rows(results[1]);
      const changeRows = rows(results[2]);
      const sourceRows = rows(results[3]);
      const coverageGapRows = rows(results[4]);
      if (briefRows.length > 1) throw new ReadModelStorageError();

      const brief = briefRows[0] === undefined ? null : decodeBrief(briefRows[0]);
      const theses = thesisRows.map(decodeCard);
      const health = summarizeHealth(sourceRows, generatedAt);
      return deepFreeze({
        methodologyVersion: brief?.methodologyVersion ?? "unavailable",
        dailyBrief: brief?.model ?? null,
        enso: theses.find((thesis) => thesis.id === "ENSO-CORE-01") ?? null,
        topChanges: changeRows.map(decodeChange),
        theses,
        coverageGaps: decodeCoverageGaps(coverageGapRows),
        sourceHealth: health.counts,
        freshness: health.freshness,
      });
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("read-models.overview", error);
      throw new ReadModelStorageError();
    }
  }

  /**
   * The list follows only the current publication pointer. It is not a
   * version-history endpoint, so drafts and superseded publications cannot
   * enter its card projection.
   */
  async theses(category: PublicThesisCategory | null, generatedAt: string): Promise<readonly ThesisCardModel[]> {
    assertCanonicalUtc(generatedAt);
    try {
      const result = await thesesStatement(this.database, category).all<Record<string, unknown>>();
      const theses = rows(result).map(decodeCard);
      if (category !== null && theses.some((thesis) => thesis.category !== category)) {
        throw new ReadModelStorageError();
      }
      return deepFreeze(theses);
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("read-models.theses", error);
      throw new ReadModelStorageError();
    }
  }

  /**
   * A standalone series is a public fact projection, not a thesis projection.
   * Both the indicator flag and its source redistribution policy must permit
   * disclosure even when no thesis currently cites the indicator.
   */
  async indicatorSeries(query: PublicIndicatorSeriesQuery): Promise<IndicatorSeriesModel | null> {
    try {
      const result = await indicatorSeriesStatement(this.database, query).all<Record<string, unknown>>();
      const seriesRows = rows(result);
      if (seriesRows.length === 0) return null;
      if (seriesRows.length > PUBLIC_INDICATOR_SERIES_POINT_LIMIT) {
        throw new PublicIndicatorSeriesRangeError();
      }
      return deepFreeze(decodePublicIndicatorSeries(seriesRows));
    } catch (error) {
      if (error instanceof ReadModelStorageError || error instanceof PublicIndicatorSeriesRangeError) throw error;
      reportStorageFailure("read-models.indicatorSeries", error);
      throw new ReadModelStorageError();
    }
  }

  async thesis(slug: string, generatedAt: string): Promise<ThesisPageModel | null> {
    assertCanonicalUtc(generatedAt);
    if (!isPublicSlug(slug)) return null;
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        currentThesisStatement(this.database, slug),
        currentEvidenceStatement(this.database, slug),
        currentIndicatorStatement(this.database, slug),
        publishedVersionsStatement(this.database, slug),
        currentEvidenceSourcesStatement(this.database, slug),
      ]);
      if (!Array.isArray(results) || results.length !== THESIS_STATEMENT_COUNT) throw new ReadModelStorageError();
      const thesisRows = rows(results[0]);
      const evidenceRows = rows(results[1]);
      const indicatorRows = rows(results[2]);
      const versionRows = rows(results[3]);
      const sourceRows = rows(results[4]);
      if (thesisRows.length === 0) {
        if (evidenceRows.length + indicatorRows.length + versionRows.length + sourceRows.length !== 0) {
          throw new ReadModelStorageError();
        }
        return null;
      }
      if (thesisRows.length !== 1) throw new ReadModelStorageError();

      const current = decodeThesis(thesisRows[0]);
      const evidence = evidenceRows.map(decodeEvidence);
      const supportingEvidence = evidence.filter((item) => item.stance === "supports");
      const counterEvidence = evidence.filter((item) => item.stance === "refutes");
      const indicators = decodeIndicators(indicatorRows);
      const versions = versionRows.map(decodeVersion);
      if (versions.length === 0 || versions[0]?.version !== current.card.version) throw new ReadModelStorageError();
      const health = summarizeHealth(sourceRows, generatedAt);
      const thesis = {
        ...current.card,
        latestEvidenceSummary: supportingEvidence[0]?.summary ?? null,
        freshness: health.freshness,
      };
      return deepFreeze({
        thesis,
        invalidation: current.invalidation,
        supportingEvidence,
        counterEvidence,
        indicators,
        versions,
        freshness: health.freshness,
      });
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("read-models.thesis", error);
      throw new ReadModelStorageError();
    }
  }

  async category(category: PublicMarketCategory, generatedAt: string): Promise<CategoryPageModel | null> {
    assertCanonicalUtc(generatedAt);
    const copy = CATEGORY_COPY[category];
    if (copy === undefined) return null;
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        categoryThesesStatement(this.database, category),
        categoryChangesStatement(this.database, category),
        categoryEvidenceSourcesStatement(this.database, category),
      ]);
      if (!Array.isArray(results) || results.length !== CATEGORY_STATEMENT_COUNT) throw new ReadModelStorageError();
      const thesisRows = rows(results[0]);
      const changeRows = rows(results[1]);
      const sourceRows = rows(results[2]);
      if (thesisRows.length === 0) {
        if (changeRows.length + sourceRows.length !== 0) throw new ReadModelStorageError();
        return null;
      }

      const theses = thesisRows.map(decodeCard);
      if (theses.some((thesis) => thesis.category !== category)) throw new ReadModelStorageError();
      const health = summarizeHealth(sourceRows, generatedAt);
      return deepFreeze({
        category,
        title: copy.title,
        summary: copy.summary,
        theses: theses.map((thesis) => ({ ...thesis, freshness: health.freshness })),
        changes: changeRows.map(decodeChange),
        coverageGaps: copy.coverageGaps,
        freshness: health.freshness,
      });
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("read-models.category", error);
      throw new ReadModelStorageError();
    }
  }

  async changes(
    cursor: ChangesCursor | null,
    query: PublicChangesQuery,
    generatedAt: string,
  ): Promise<ChangesPageModel> {
    assertCanonicalUtc(generatedAt);
    if (cursor !== null) assertChangesCursor(cursor);
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        changesStatement(this.database, cursor, query),
        this.database.prepare(
          `SELECT source.id, source.last_success_at, source.late_after_minutes,
                  source.stale_after_minutes, source.consecutive_failures, source.last_error_code
             FROM sources source
            WHERE source.enabled = 1
            ORDER BY source.id`,
        ),
      ]);
      if (!Array.isArray(results) || results.length !== CHANGES_STATEMENT_COUNT) throw new ReadModelStorageError();
      const changeRows = rows(results[0]);
      const sourceRows = rows(results[1]);
      if (changeRows.length > PUBLIC_CHANGES_PAGE_SIZE + 1) throw new ReadModelStorageError();

      const decoded = changeRows.map(decodePublicChange);
      const page = decoded.slice(0, PUBLIC_CHANGES_PAGE_SIZE);
      const nextCursor = decoded.length > PUBLIC_CHANGES_PAGE_SIZE
        ? encodeChangesCursor(page.at(-1)!)
        : null;
      const health = summarizeHealth(sourceRows, generatedAt);
      return deepFreeze({ changes: page, nextCursor, freshness: health.freshness });
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("read-models.changes", error);
      throw new ReadModelStorageError();
    }
  }

  async dataHealth(generatedAt: string): Promise<DataHealthPageModel> {
    assertCanonicalUtc(generatedAt);
    const sevenDaysAgo = new Date(Date.parse(generatedAt) - 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await this.database.prepare(dataHealthQuery()).bind(sevenDaysAgo).all<Record<string, unknown>>();
      const sourceRows = rows(result);
      return deepFreeze({
        generatedAt,
        sources: sourceRows.map((row) => decodeSourceHealth(row, generatedAt)),
      });
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("read-models.dataHealth", error);
      throw new ReadModelStorageError();
    }
  }

  async methodology(generatedAt: string): Promise<MethodologyPageModel> {
    assertCanonicalUtc(generatedAt);
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        this.database.prepare(
          `SELECT brief.published_at,
                  (SELECT link.methodology_version
                     FROM daily_brief_theses link
                    WHERE link.brief_date = brief.brief_date
                    ORDER BY link.sort_order
                    LIMIT 1) AS methodology_version
             FROM daily_briefs brief
            WHERE brief.status = 'published'
            ORDER BY brief.brief_date DESC
            LIMIT 1`,
        ),
        this.database.prepare(LATEST_DAILY_BRIEF_COVERAGE_GAPS_QUERY),
      ]);
      if (!Array.isArray(results) || results.length !== METHODOLOGY_STATEMENT_COUNT) {
        throw new ReadModelStorageError();
      }
      const methodRows = rows(results[0]);
      const coverageGapRows = rows(results[1]);
      if (methodRows.length > 1) throw new ReadModelStorageError();
      const published = methodRows[0] === undefined ? null : decodeMethodologyVersion(methodRows[0]);
      return deepFreeze({
        methodologyVersion: published?.methodologyVersion ?? "unavailable",
        lastUpdatedAt: published?.lastUpdatedAt ?? generatedAt,
        sections: METHODOLOGY_SECTIONS,
        coverageGaps: decodeCoverageGaps(coverageGapRows),
      });
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("read-models.methodology", error);
      throw new ReadModelStorageError();
    }
  }
}

/**
 * A dedicated bounded projection for Atom. It follows the public changes
 * release rules instead of inspecting draft versions or change JSON payloads.
 */
export class D1AtomFeedRepository implements AtomFeedRepository {
  constructor(private readonly database: D1Database) {}

  async feed(generatedAt: string): Promise<AtomFeedModel> {
    assertCanonicalUtc(generatedAt);
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        feedChangesStatement(this.database),
        this.database.prepare(
          `SELECT brief.brief_date, brief.headline, brief.summary, brief.data_cutoff, brief.published_at
             FROM daily_briefs brief
            WHERE brief.status = 'published' AND brief.published_at IS NOT NULL
            ORDER BY brief.published_at DESC, brief.brief_date DESC
            LIMIT ?`,
        ).bind(FEED_DAILY_BRIEF_LIMIT),
      ]);
      if (!Array.isArray(results) || results.length !== 2) throw new ReadModelStorageError();
      const changes = rows(results[0]);
      const dailyBriefs = rows(results[1]);
      if (changes.length > FEED_CHANGE_LIMIT || dailyBriefs.length > FEED_DAILY_BRIEF_LIMIT) {
        throw new ReadModelStorageError();
      }
      return deepFreeze({
        changes: changes.map(decodePublicChange),
        dailyBriefs: dailyBriefs.map(decodeAtomDailyBrief),
      });
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("atom-feed", error);
      throw new ReadModelStorageError();
    }
  }
}

/**
 * A daily brief keeps its own frozen thesis links. Do not replace this with a
 * current-publication query: historic daily records must not drift when a
 * thesis is later revised or withdrawn.
 */
export class D1PublicDailyBriefRepository implements PublicDailyBriefRepository {
  constructor(private readonly database: D1Database) {}

  async findPublished(briefDate: string): Promise<DailyBriefPageModel | null> {
    try {
      const results = await this.database.batch<Record<string, unknown>>([
        this.database.prepare(
          `SELECT brief.brief_date, brief.headline, brief.summary, brief.data_cutoff, brief.published_at,
                  (SELECT link.methodology_version
                     FROM daily_brief_theses link
                    WHERE link.brief_date = brief.brief_date
                    ORDER BY link.sort_order
                    LIMIT 1) AS methodology_version
             FROM daily_briefs brief
            WHERE brief.brief_date = ?
              AND brief.status = 'published'
              AND brief.published_at IS NOT NULL
            LIMIT 1`,
        ).bind(briefDate),
        this.database.prepare(
          `SELECT link.thesis_id, link.sort_order, thesis.slug, thesis.title, thesis.category, thesis.region,
                  thesis.market_scope, version.version, version.direction, version.stage, version.confidence,
                  version.summary, version.invalidation, version.based_on_cutoff, version.published_at
             FROM daily_briefs brief
             JOIN daily_brief_theses link ON link.brief_date = brief.brief_date
             JOIN theses thesis ON thesis.id = link.thesis_id
             JOIN thesis_versions version
               ON version.id = link.thesis_version_id
              AND version.thesis_id = link.thesis_id
              AND version.status IN ('published', 'withdrawn')
            WHERE brief.brief_date = ?
              AND brief.status = 'published'
              AND brief.published_at IS NOT NULL
            ORDER BY link.sort_order`,
        ).bind(briefDate),
      ]);
      if (!Array.isArray(results) || results.length !== DAILY_BRIEF_STATEMENT_COUNT) {
        throw new ReadModelStorageError();
      }
      const briefRows = rows(results[0]);
      const thesisRows = rows(results[1]);
      if (briefRows.length === 0) {
        if (thesisRows.length !== 0) throw new ReadModelStorageError();
        return null;
      }
      if (briefRows.length !== 1) throw new ReadModelStorageError();
      return decodePublicDailyBrief(briefRows[0], thesisRows);
    } catch (error) {
      if (error instanceof ReadModelStorageError) throw error;
      reportStorageFailure("public-daily-briefs", error);
      throw new ReadModelStorageError();
    }
  }
}

function currentThesisStatement(database: D1Database, slug: string): D1PreparedStatement {
  return database.prepare(CURRENT_PUBLISHED_THESIS_QUERY).bind(slug);
}

function thesesStatement(
  database: D1Database,
  category: PublicThesisCategory | null,
): D1PreparedStatement {
  return category === null
    ? database.prepare(OVERVIEW_PUBLISHED_THESES_QUERY)
    : database.prepare(CATEGORY_PUBLISHED_THESES_QUERY).bind(category);
}

function indicatorSeriesStatement(
  database: D1Database,
  query: PublicIndicatorSeriesQuery,
): D1PreparedStatement {
  return database.prepare(PUBLIC_INDICATOR_SERIES_QUERY)
    .bind(query.from, query.to, query.indicatorId, PUBLIC_INDICATOR_SERIES_POINT_LIMIT + 1);
}

function categoryThesesStatement(database: D1Database, category: PublicMarketCategory): D1PreparedStatement {
  return database.prepare(CATEGORY_PUBLISHED_THESES_QUERY).bind(category);
}

function categoryChangesStatement(database: D1Database, category: PublicMarketCategory): D1PreparedStatement {
  return database.prepare(CATEGORY_PUBLISHED_CHANGES_QUERY).bind(category, CATEGORY_CHANGE_LIMIT);
}

function categoryEvidenceSourcesStatement(database: D1Database, category: PublicMarketCategory): D1PreparedStatement {
  return database.prepare(
    `SELECT DISTINCT source.id, source.last_success_at, source.late_after_minutes,
            source.stale_after_minutes, source.consecutive_failures, source.last_error_code
       FROM theses thesis
       JOIN thesis_publications publication ON publication.thesis_id = thesis.id
       JOIN thesis_versions version
         ON version.id = publication.current_version_id
        AND version.thesis_id = thesis.id
        AND version.status = 'published'
       JOIN evidence ON evidence.thesis_version_id = version.id
       LEFT JOIN observations observation
         ON observation.id = evidence.observation_id AND observation.quality <> 'invalid'
       LEFT JOIN indicators indicator ON indicator.id = observation.indicator_id
       LEFT JOIN sources observation_source ON observation_source.id = indicator.source_id
       LEFT JOIN source_runs source_run
         ON source_run.id = evidence.source_run_id
        AND source_run.status IN ('success', 'unchanged', 'partial')
        AND source_run.finished_at IS NOT NULL
       LEFT JOIN sources run_source ON run_source.id = source_run.source_id
       JOIN sources source ON source.id = COALESCE(observation_source.id, run_source.id)
      WHERE thesis.category = ? AND thesis.active = 1
        AND evidence.stance IN ('supports', 'refutes')`,
  ).bind(category);
}

function changesStatement(
  database: D1Database,
  cursor: ChangesCursor | null,
  query: PublicChangesQuery,
): D1PreparedStatement {
  const built = changesQuery(cursor, query);
  return database.prepare(built.sql).bind(...built.values, PUBLIC_CHANGES_PAGE_SIZE + 1);
}

function feedChangesStatement(database: D1Database): D1PreparedStatement {
  return database.prepare(changesQuery(null, EMPTY_PUBLIC_CHANGES_QUERY, MAJOR_CHANGE_IMPORTANCE).sql)
    .bind(MAJOR_CHANGE_IMPORTANCE, FEED_CHANGE_LIMIT);
}

export function publicChangesQueryForPlan(query: PublicChangesQuery = EMPTY_PUBLIC_CHANGES_QUERY): string {
  return changesQuery(null, query).sql.replace("LIMIT ?", `LIMIT ${PUBLIC_CHANGES_PAGE_SIZE + 1}`);
}

/**
 * Builds the public change projection together with its bind values, so the SQL text and the bound
 * parameters can never drift apart. Filter clauses narrow the change's own thesis attribution and
 * keep using the chronological or thesis indexes.
 */
function changesQuery(
  cursor: ChangesCursor | null,
  query: PublicChangesQuery,
  minimumImportance?: number,
): { readonly sql: string; readonly values: readonly unknown[] } {
  const cursorClause = cursor === null
    ? ""
    : "AND (change.detected_at < ? OR (change.detected_at = ? AND change.id < ?))";
  const importanceClause = minimumImportance === undefined ? "" : "AND change.importance >= ?";
  const categoryClause = query.category === null
    ? ""
    : `AND EXISTS (
         SELECT 1 FROM theses category_thesis
          WHERE category_thesis.id = change.thesis_id
            AND category_thesis.category = ?
            AND category_thesis.active = 1
       )`;
  const thesisClause = query.thesisId === null ? "" : "AND change.thesis_id = ?";
  const fromClause = query.from === null ? "" : "AND change.detected_at >= ?";
  const toClause = query.to === null ? "" : "AND change.detected_at <= ?";

  const values = [
    ...(minimumImportance === undefined ? [] : [minimumImportance]),
    ...(query.category === null ? [] : [query.category]),
    ...(query.thesisId === null ? [] : [query.thesisId]),
    ...(query.from === null ? [] : [query.from]),
    ...(query.to === null ? [] : [query.to]),
    ...(cursor === null ? [] : [cursor.detectedAt, cursor.detectedAt, cursor.id]),
  ];

  return {
    sql: `SELECT change.id, change.change_type, thesis.id AS thesis_id, thesis.title AS thesis_title,
            change.detected_at,
            COALESCE(indicator_source.name, source_change.name) AS source_name,
            COALESCE(indicator_source.organization, source_change.organization) AS source_organization,
            COALESCE(indicator_source.homepage_url, source_change.homepage_url) AS source_homepage_url,
            CASE WHEN publication.thesis_id IS NULL THEN 0 ELSE 1 END AS published_in_current_thesis
       FROM changes change
       LEFT JOIN thesis_versions released_version
         ON released_version.id = change.published_version_id
        AND released_version.status = 'published'
       LEFT JOIN theses thesis
         ON thesis.id = released_version.thesis_id AND thesis.active = 1
       LEFT JOIN thesis_publications publication
         ON publication.thesis_id = released_version.thesis_id
        AND publication.current_version_id = released_version.id
       LEFT JOIN indicators indicator
         ON indicator.id = change.indicator_id AND indicator.public = 1
       LEFT JOIN sources indicator_source
         ON indicator_source.id = indicator.source_id
        AND indicator_source.redistribution IN ('allowed', 'derived_only')
       LEFT JOIN sources source_change
         ON source_change.id = change.source_id AND source_change.enabled = 1
      WHERE (
        thesis.id IS NOT NULL
        OR (
          change.published_version_id IS NULL
          AND (indicator_source.id IS NOT NULL OR source_change.id IS NOT NULL)
        )
      )
        ${importanceClause}
        ${categoryClause}
        ${thesisClause}
        ${fromClause}
        ${toClause}
        ${cursorClause}
      ORDER BY change.detected_at DESC, change.id DESC
      LIMIT ?`,
    values,
  };
}

function dataHealthQuery(): string {
  return `SELECT source.id, source.name, source.organization, source.homepage_url,
                 source.cadence_minutes, source.last_success_at, source.late_after_minutes,
                 source.stale_after_minutes, source.consecutive_failures, source.last_error_code,
                 (
                   SELECT MAX(observation.published_at)
                     FROM indicators indicator
                     JOIN observations observation
                       ON observation.indicator_id = indicator.id
                      AND observation.quality <> 'invalid'
                    WHERE indicator.source_id = source.id AND indicator.public = 1
                 ) AS last_published_at,
                 (
                   SELECT CASE WHEN COUNT(*) = 0 THEN NULL
                     ELSE ROUND(100.0 * SUM(CASE WHEN run.status IN ('success', 'unchanged') THEN 1 ELSE 0 END) / COUNT(*), 1)
                   END
                     FROM source_runs run
                    WHERE run.source_id = source.id
                      AND run.finished_at IS NOT NULL
                      AND run.finished_at >= ?
                 ) AS seven_day_success_rate,
                 COALESCE((
                   SELECT json_group_array(name)
                     FROM (
                       SELECT indicator.name
                         FROM indicators indicator
                        WHERE indicator.source_id = source.id AND indicator.public = 1
                        ORDER BY indicator.id
                     )
                 ), '[]') AS affected_indicators_json,
                 COALESCE((
                   SELECT json_group_array(id)
                     FROM (
                       SELECT DISTINCT thesis.id
                         FROM thesis_publications publication
                         JOIN thesis_versions version
                           ON version.id = publication.current_version_id
                          AND version.thesis_id = publication.thesis_id
                          AND version.status = 'published'
                         JOIN theses thesis ON thesis.id = publication.thesis_id AND thesis.active = 1
                         JOIN evidence ON evidence.thesis_version_id = version.id
                         LEFT JOIN observations observation
                           ON observation.id = evidence.observation_id AND observation.quality <> 'invalid'
                         LEFT JOIN indicators indicator ON indicator.id = observation.indicator_id
                         LEFT JOIN source_runs run
                           ON run.id = evidence.source_run_id
                          AND run.status IN ('success', 'unchanged', 'partial')
                          AND run.finished_at IS NOT NULL
                        WHERE indicator.source_id = source.id OR run.source_id = source.id
                        ORDER BY thesis.id
                     )
                 ), '[]') AS affected_theses_json
            FROM sources source
           WHERE source.enabled = 1
           ORDER BY source.id`;
}

function currentEvidenceStatement(database: D1Database, slug: string): D1PreparedStatement {
  return database.prepare(
    `SELECT evidence.summary, evidence.layer, evidence.stance, evidence.citation_url,
            COALESCE(observation_source.name, run_source.name) AS source_name,
            COALESCE(observation_source.organization, run_source.organization) AS source_organization,
            observation.observed_at, observation.published_at,
            COALESCE(observation.fetched_at, source_run.finished_at) AS fetched_at,
            CASE WHEN indicator.public = 1 THEN observation.quality ELSE 'verified' END AS quality,
            CASE WHEN indicator.public = 1 THEN observation.revision ELSE 0 END AS revision,
            CASE WHEN indicator.public = 1 THEN observation.value_num ELSE NULL END AS value_num,
            CASE WHEN indicator.public = 1 THEN observation.value_text ELSE NULL END AS value_text,
            CASE WHEN indicator.public = 1 THEN observation.unit ELSE NULL END AS unit,
            evidence.sort_order
       FROM theses thesis
       JOIN thesis_publications publication
         ON publication.thesis_id = thesis.id
       JOIN thesis_versions version
         ON version.id = publication.current_version_id
        AND version.thesis_id = thesis.id
        AND version.status = 'published'
       JOIN evidence ON evidence.thesis_version_id = version.id
       LEFT JOIN observations observation
         ON observation.id = evidence.observation_id AND observation.quality <> 'invalid'
       LEFT JOIN indicators indicator ON indicator.id = observation.indicator_id
       LEFT JOIN sources observation_source ON observation_source.id = indicator.source_id
       LEFT JOIN source_runs source_run
         ON source_run.id = evidence.source_run_id
        AND source_run.status IN ('success', 'unchanged', 'partial')
        AND source_run.finished_at IS NOT NULL
       LEFT JOIN sources run_source ON run_source.id = source_run.source_id
      WHERE thesis.slug = ? AND thesis.active = 1
        AND evidence.stance IN ('supports', 'refutes')
        AND COALESCE(observation_source.id, run_source.id) IS NOT NULL
      ORDER BY evidence.stance, evidence.sort_order, evidence.id`,
  ).bind(slug);
}

function currentIndicatorStatement(database: D1Database, slug: string): D1PreparedStatement {
  return database.prepare(
    `WITH selected_indicators AS (
       SELECT DISTINCT indicator.id
         FROM theses thesis
         JOIN thesis_publications publication
           ON publication.thesis_id = thesis.id
         JOIN thesis_versions version
           ON version.id = publication.current_version_id
          AND version.thesis_id = thesis.id
          AND version.status = 'published'
         JOIN evidence ON evidence.thesis_version_id = version.id
         JOIN observations selected_observation
           ON selected_observation.id = evidence.observation_id
          AND selected_observation.quality <> 'invalid'
         JOIN indicators indicator
           ON indicator.id = selected_observation.indicator_id AND indicator.public = 1
        WHERE thesis.slug = ? AND thesis.active = 1
        ORDER BY indicator.id
        LIMIT ${PUBLIC_INDICATOR_LIMIT}
     )
     SELECT indicator.id, indicator.name, observation.observed_at, observation.value_num,
            observation.value_text, observation.unit, observation.quality, observation.revision,
            source.name AS source_name, source.organization AS source_organization,
            observation.citation_url, observation.published_at, observation.fetched_at
       FROM selected_indicators selected
       JOIN indicators indicator ON indicator.id = selected.id AND indicator.public = 1
       JOIN observations observation
         ON observation.indicator_id = indicator.id AND observation.quality <> 'invalid'
       JOIN sources source ON source.id = indicator.source_id
      ORDER BY indicator.id, observation.observed_at, observation.revision`,
  ).bind(slug);
}

function publishedVersionsStatement(database: D1Database, slug: string): D1PreparedStatement {
  return database.prepare(
    `SELECT version.version, version.direction, version.stage, version.confidence,
            version.summary, version.published_at, version.change_reason
       FROM theses thesis
       JOIN thesis_publications publication ON publication.thesis_id = thesis.id
       JOIN thesis_versions current_version
         ON current_version.id = publication.current_version_id
        AND current_version.thesis_id = thesis.id
        AND current_version.status = 'published'
       JOIN thesis_versions version
         ON version.thesis_id = thesis.id AND version.status = 'published'
      WHERE thesis.slug = ? AND thesis.active = 1
      ORDER BY version.version DESC`,
  ).bind(slug);
}

function currentEvidenceSourcesStatement(database: D1Database, slug: string): D1PreparedStatement {
  return database.prepare(
    `SELECT DISTINCT source.id, source.last_success_at, source.late_after_minutes,
            source.stale_after_minutes, source.consecutive_failures, source.last_error_code
       FROM theses thesis
       JOIN thesis_publications publication ON publication.thesis_id = thesis.id
       JOIN thesis_versions version
         ON version.id = publication.current_version_id
        AND version.thesis_id = thesis.id
        AND version.status = 'published'
       JOIN evidence ON evidence.thesis_version_id = version.id
       LEFT JOIN observations observation
         ON observation.id = evidence.observation_id AND observation.quality <> 'invalid'
       LEFT JOIN indicators indicator ON indicator.id = observation.indicator_id
       LEFT JOIN sources observation_source ON observation_source.id = indicator.source_id
       LEFT JOIN source_runs source_run
         ON source_run.id = evidence.source_run_id
        AND source_run.status IN ('success', 'unchanged', 'partial')
        AND source_run.finished_at IS NOT NULL
       LEFT JOIN sources run_source ON run_source.id = source_run.source_id
       JOIN sources source ON source.id = COALESCE(observation_source.id, run_source.id)
      WHERE thesis.slug = ? AND thesis.active = 1
        AND evidence.stance IN ('supports', 'refutes')`,
  ).bind(slug);
}

function decodeBrief(row: Record<string, unknown>): {
  readonly model: NonNullable<OverviewPageModel["dailyBrief"]>;
  readonly methodologyVersion: string;
} {
  const item = exactRecord(row, [
    "brief_date", "headline", "summary", "data_cutoff", "published_at", "methodology_version",
  ]);
  return {
    model: {
      briefDate: calendarDate(item.brief_date),
      headline: nonEmptyString(item.headline),
      summary: nonEmptyString(item.summary),
      dataCutoff: canonicalUtc(item.data_cutoff),
      publishedAt: canonicalUtc(item.published_at),
    },
    methodologyVersion: nonEmptyString(item.methodology_version),
  };
}

function decodePublicDailyBrief(
  briefRow: Record<string, unknown>,
  thesisRows: readonly Record<string, unknown>[],
): DailyBriefPageModel {
  const brief = exactRecord(briefRow, [
    "brief_date", "headline", "summary", "data_cutoff", "published_at", "methodology_version",
  ]);
  if (thesisRows.length !== REQUIRED_DAILY_THESIS_IDS.length) throw new ReadModelStorageError();
  const theses = thesisRows.map(decodePublicDailyBriefThesis);
  for (const [index, thesisId] of REQUIRED_DAILY_THESIS_IDS.entries()) {
    if (theses[index]?.thesisId !== thesisId) throw new ReadModelStorageError();
  }
  return deepFreeze({
    briefDate: calendarDate(brief.brief_date),
    headline: nonEmptyString(brief.headline),
    summary: nonEmptyString(brief.summary),
    dataCutoff: canonicalUtc(brief.data_cutoff),
    publishedAt: canonicalUtc(brief.published_at),
    methodologyVersion: nullableString(brief.methodology_version) ?? "unavailable",
    theses,
  });
}

function decodePublicDailyBriefThesis(row: Record<string, unknown>): DailyBriefThesisModel {
  const item = exactRecord(row, [
    "thesis_id", "sort_order", "slug", "title", "category", "region", "market_scope", "version",
    "direction", "stage", "confidence", "summary", "invalidation", "based_on_cutoff", "published_at",
  ]);
  const thesisId = nonEmptyString(item.thesis_id);
  const seed = INITIAL_THESIS_SEEDS.find((candidate) => candidate.id === thesisId);
  if (seed === undefined) throw new ReadModelStorageError();
  const sortOrder = integer(item.sort_order, 0, REQUIRED_DAILY_THESIS_IDS.length - 1);
  if (REQUIRED_DAILY_THESIS_IDS[sortOrder] !== thesisId) throw new ReadModelStorageError();
  const category = enumValue(item.category, ["climate", "rubber", "agriculture", "shipping"] as const);
  if (category !== seed.category) throw new ReadModelStorageError();
  return {
    thesisId,
    slug: nonEmptyString(item.slug),
    title: nonEmptyString(item.title),
    category,
    region: nonEmptyString(item.region),
    marketScope: nonEmptyString(item.market_scope),
    timeHorizon: seed.timeHorizon,
    version: integer(item.version, 1),
    direction: enumValue(item.direction, THESIS_DIRECTIONS),
    stage: enumValue(item.stage, THESIS_STAGES),
    confidence: integer(item.confidence, 0, 100),
    summary: nonEmptyString(item.summary),
    invalidation: nonEmptyString(item.invalidation),
    basedOnCutoff: canonicalUtc(item.based_on_cutoff),
    publishedAt: canonicalUtc(item.published_at),
  };
}

function decodeCard(row: Record<string, unknown>): ThesisCardModel {
  return decodeCardFields(exactRecord(row, [
    "id", "slug", "title", "category", "region", "market_scope", "direction", "stage",
    "confidence", "summary", "based_on_cutoff", "published_at", "version",
  ]));
}

function decodeThesis(row: Record<string, unknown>): {
  readonly card: ThesisCardModel;
  readonly invalidation: string;
} {
  const item = exactRecord(row, [
    "id", "slug", "title", "category", "region", "market_scope", "direction", "stage",
    "confidence", "summary", "based_on_cutoff", "published_at", "version", "invalidation",
  ]);
  return {
    card: decodeCardFields(item),
    invalidation: nonEmptyString(item.invalidation),
  };
}

function decodeCardFields(item: Record<string, unknown>): ThesisCardModel {
  const id = nonEmptyString(item.id);
  const seed = INITIAL_THESIS_SEEDS.find((candidate) => candidate.id === id);
  if (seed === undefined) throw new ReadModelStorageError();
  const category = enumValue(item.category, ["climate", "rubber", "agriculture", "shipping"] as const);
  if (category !== seed.category) throw new ReadModelStorageError();
  return {
    id,
    slug: nonEmptyString(item.slug),
    title: nonEmptyString(item.title),
    category: category as PublicThesisCategory,
    region: nonEmptyString(item.region),
    marketScope: nonEmptyString(item.market_scope),
    timeHorizon: seed.timeHorizon,
    direction: enumValue(item.direction, THESIS_DIRECTIONS),
    stage: enumValue(item.stage, THESIS_STAGES),
    confidence: integer(item.confidence, 0, 100),
    summary: nonEmptyString(item.summary),
    latestEvidenceSummary: null,
    freshness: "current",
    basedOnCutoff: canonicalUtc(item.based_on_cutoff),
    publishedAt: canonicalUtc(item.published_at),
    version: integer(item.version, 1),
  };
}

function decodeEvidence(row: Record<string, unknown>): ThesisEvidenceModel {
  const item = exactRecord(row, [
    "summary", "layer", "stance", "citation_url", "source_name", "source_organization",
    "observed_at", "published_at", "fetched_at", "quality", "revision", "value_num",
    "value_text", "unit", "sort_order",
  ]);
  const value = scalarValue(item.value_num, item.value_text);
  const unit = nullableString(item.unit);
  if ((value === null) !== (unit === null)) throw new ReadModelStorageError();
  return {
    summary: nonEmptyString(item.summary),
    layer: enumValue(item.layer, ["forecast", "weather", "physical", "balance", "market", "control"] as const),
    stance: enumValue(item.stance, ["supports", "refutes"] as const),
    source: sourceReference(item.source_name, item.source_organization, item.citation_url),
    times: {
      observedAt: nullableCanonicalUtc(item.observed_at),
      publishedAt: nullableCanonicalUtc(item.published_at),
      fetchedAt: canonicalUtc(item.fetched_at),
    },
    quality: enumValue(item.quality, ["verified", "provisional", "estimated", "manual"] as const),
    revision: integer(item.revision, 0),
    valueLabel: value === null ? null : `${value} ${unit}`,
  };
}

function decodeIndicators(rowsInput: readonly Record<string, unknown>[]): readonly IndicatorSeriesModel[] {
  const series = new Map<string, {
    name: string;
    unit: string;
    points: IndicatorPointModel[];
  }>();
  for (const row of rowsInput) {
    const item = exactRecord(row, [
      "id", "name", "observed_at", "value_num", "value_text", "unit", "quality", "revision",
      "source_name", "source_organization", "citation_url", "published_at", "fetched_at",
    ]);
    const id = nonEmptyString(item.id);
    const name = nonEmptyString(item.name);
    const unit = nonEmptyString(item.unit);
    const current = series.get(id);
    if (current !== undefined && (current.name !== name || current.unit !== unit)) {
      throw new ReadModelStorageError();
    }
    const point: IndicatorPointModel = {
      observedAt: canonicalUtc(item.observed_at),
      value: scalarValue(item.value_num, item.value_text),
      unit,
      quality: enumValue(item.quality, ["verified", "provisional", "estimated", "manual"] as const),
      revision: integer(item.revision, 0),
      isRevision: integer(item.revision, 0) > 0,
      source: sourceReference(item.source_name, item.source_organization, item.citation_url),
      times: {
        observedAt: canonicalUtc(item.observed_at),
        publishedAt: nullableCanonicalUtc(item.published_at),
        fetchedAt: canonicalUtc(item.fetched_at),
      },
    };
    if (current === undefined) {
      series.set(id, { name, unit, points: [point] });
    } else {
      current.points.push(point);
    }
  }
  if (series.size > PUBLIC_INDICATOR_LIMIT) throw new ReadModelStorageError();
  return [...series.entries()].map(([id, item]) => ({
    id,
    name: item.name,
    unit: item.unit,
    points: item.points,
    missingReason: null,
  }));
}

function decodePublicIndicatorSeries(rowsInput: readonly Record<string, unknown>[]): IndicatorSeriesModel {
  const first = exactRecord(rowsInput[0], [
    "id", "name", "indicator_unit", "source_name", "source_organization", "observed_at", "value_num",
    "value_text", "observation_unit", "quality", "revision", "citation_url", "published_at", "fetched_at",
  ]);
  const id = nonEmptyString(first.id);
  const name = nonEmptyString(first.name);
  const unit = nonEmptyString(first.indicator_unit);
  const sourceName = nonEmptyString(first.source_name);
  const sourceOrganization = nonEmptyString(first.source_organization);
  const points: IndicatorPointModel[] = [];

  for (const row of rowsInput) {
    const item = exactRecord(row, [
      "id", "name", "indicator_unit", "source_name", "source_organization", "observed_at", "value_num",
      "value_text", "observation_unit", "quality", "revision", "citation_url", "published_at", "fetched_at",
    ]);
    if (
      nonEmptyString(item.id) !== id
      || nonEmptyString(item.name) !== name
      || nonEmptyString(item.indicator_unit) !== unit
      || nonEmptyString(item.source_name) !== sourceName
      || nonEmptyString(item.source_organization) !== sourceOrganization
    ) throw new ReadModelStorageError();

    if (item.observed_at === null) {
      if (
        item.value_num !== null || item.value_text !== null || item.observation_unit !== null
        || item.quality !== null || item.revision !== null || item.citation_url !== null
        || item.published_at !== null || item.fetched_at !== null
      ) throw new ReadModelStorageError();
      continue;
    }

    const pointUnit = nonEmptyString(item.observation_unit);
    if (pointUnit !== unit) throw new ReadModelStorageError();
    points.push({
      observedAt: canonicalUtc(item.observed_at),
      value: scalarValue(item.value_num, item.value_text),
      unit: pointUnit,
      quality: enumValue(item.quality, ["verified", "provisional", "estimated", "manual"] as const),
      revision: integer(item.revision, 0),
      isRevision: integer(item.revision, 0) > 0,
      source: sourceReference(sourceName, sourceOrganization, item.citation_url),
      times: {
        observedAt: canonicalUtc(item.observed_at),
        publishedAt: nullableCanonicalUtc(item.published_at),
        fetchedAt: canonicalUtc(item.fetched_at),
      },
    });
  }
  if (points.length > PUBLIC_INDICATOR_SERIES_POINT_LIMIT) throw new PublicIndicatorSeriesRangeError();
  return {
    id,
    name,
    unit,
    points,
    missingReason: points.length === 0 ? "所选时间范围内暂无可公开观测" : null,
  };
}

function decodeVersion(row: Record<string, unknown>): ThesisVersionTimelineModel {
  const item = exactRecord(row, [
    "version", "direction", "stage", "confidence", "summary", "published_at", "change_reason",
  ]);
  return {
    version: integer(item.version, 1),
    direction: enumValue(item.direction, THESIS_DIRECTIONS),
    stage: enumValue(item.stage, THESIS_STAGES),
    confidence: integer(item.confidence, 0, 100),
    summary: nonEmptyString(item.summary),
    publishedAt: canonicalUtc(item.published_at),
    changeReason: nullableString(item.change_reason),
  };
}

function sourceReference(name: unknown, organization: unknown, citationUrl: unknown): PublicSourceReference {
  const url = validHttpUrl(citationUrl);
  return {
    name: nonEmptyString(name),
    organization: nonEmptyString(organization),
    citationUrl: url,
  };
}

function validHttpUrl(value: unknown): string {
  const url = nonEmptyString(value);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new ReadModelStorageError();
  } catch {
    throw new ReadModelStorageError();
  }
  return url;
}

function scalarValue(numberValue: unknown, textValue: unknown): number | string | null {
  if (numberValue === null && textValue === null) return null;
  if (typeof numberValue === "number" && Number.isFinite(numberValue) && textValue === null) return numberValue;
  if (numberValue === null && typeof textValue === "string" && textValue.trim().length > 0) return textValue;
  throw new ReadModelStorageError();
}

function decodeChange(row: Record<string, unknown>): PublicChangeModel {
  const item = exactRecord(row, ["id", "change_type", "thesis_id", "thesis_title", "detected_at"]);
  const type = enumValue(item.change_type, [
    "observation", "revision", "threshold", "thesis", "source_health", "manual",
  ] as const);
  const thesisId = nullableString(item.thesis_id);
  const thesisTitle = nullableString(item.thesis_title);
  if ((thesisId === null) !== (thesisTitle === null)) throw new ReadModelStorageError();
  return {
    id: nonEmptyString(item.id),
    type,
    thesisId,
    thesisTitle,
    summary: changeSummary(type),
    beforeLabel: null,
    afterLabel: "已进入公开版本",
    detectedAt: canonicalUtc(item.detected_at),
    publishedInCurrentThesis: true,
    source: null,
  };
}

function decodePublicChange(row: Record<string, unknown>): PublicChangeModel {
  const item = exactRecord(row, [
    "id", "change_type", "thesis_id", "thesis_title", "detected_at", "source_name",
    "source_organization", "source_homepage_url", "published_in_current_thesis",
  ]);
  const type = enumValue(item.change_type, [
    "observation", "revision", "threshold", "thesis", "source_health", "manual",
  ] as const);
  const thesisId = nullableString(item.thesis_id);
  const thesisTitle = nullableString(item.thesis_title);
  if ((thesisId === null) !== (thesisTitle === null)) throw new ReadModelStorageError();
  const sourceName = nullableString(item.source_name);
  const sourceOrganization = nullableString(item.source_organization);
  const sourceHomepageUrl = nullableString(item.source_homepage_url);
  if (
    (sourceName === null) !== (sourceOrganization === null)
    || (sourceName === null) !== (sourceHomepageUrl === null)
  ) throw new ReadModelStorageError();
  const publishedInCurrentThesis = integer(item.published_in_current_thesis, 0, 1) === 1;
  return {
    id: nonEmptyString(item.id),
    type,
    thesisId,
    thesisTitle,
    summary: changeSummary(type),
    beforeLabel: null,
    afterLabel: publishedInCurrentThesis ? "已进入当前公开版本" : "已记录为公开事实",
    detectedAt: canonicalUtc(item.detected_at),
    publishedInCurrentThesis,
    source: sourceName === null
      ? null
      : sourceReference(sourceName, sourceOrganization, sourceHomepageUrl),
  };
}

function decodeAtomDailyBrief(row: Record<string, unknown>): AtomDailyBriefModel {
  const item = exactRecord(row, ["brief_date", "headline", "summary", "data_cutoff", "published_at"]);
  return {
    briefDate: calendarDate(item.brief_date),
    headline: nonEmptyString(item.headline),
    summary: nonEmptyString(item.summary),
    dataCutoff: canonicalUtc(item.data_cutoff),
    publishedAt: canonicalUtc(item.published_at),
  };
}

function decodeSourceHealth(row: Record<string, unknown>, generatedAt: string): SourceHealthModel {
  const item = exactRecord(row, [
    "id", "name", "organization", "homepage_url", "cadence_minutes", "last_success_at",
    "late_after_minutes", "stale_after_minutes", "consecutive_failures", "last_error_code",
    "last_published_at", "seven_day_success_rate", "affected_indicators_json", "affected_theses_json",
  ]);
  const sourceId = nonEmptyString(item.id);
  const errorCode = item.last_error_code === null
    ? null
    : enumValue(item.last_error_code, SOURCE_ERROR_CODES) as SourceErrorCode;
  const status = calculateSourceHealth({
    sourceId,
    checkedAt: generatedAt,
    lastSuccessAt: nullableCanonicalUtc(item.last_success_at),
    lateAfterMinutes: integer(item.late_after_minutes, 0),
    staleAfterMinutes: integer(item.stale_after_minutes, 0),
    consecutiveFailures: integer(item.consecutive_failures, 0),
    lastErrorCode: errorCode,
  }).status;
  return {
    sourceId,
    name: nonEmptyString(item.name),
    organization: nonEmptyString(item.organization),
    homepageUrl: validHttpUrl(item.homepage_url),
    status,
    cadenceMinutes: integer(item.cadence_minutes, 1),
    lastSuccessAt: nullableCanonicalUtc(item.last_published_at),
    lastFetchedAt: nullableCanonicalUtc(item.last_success_at),
    sevenDaySuccessRate: nullablePercentage(item.seven_day_success_rate),
    affectedIndicators: stringArray(item.affected_indicators_json),
    affectedTheses: stringArray(item.affected_theses_json),
  };
}

function decodeMethodologyVersion(row: Record<string, unknown>): {
  readonly methodologyVersion: string;
  readonly lastUpdatedAt: string;
} {
  const item = exactRecord(row, ["published_at", "methodology_version"]);
  return {
    methodologyVersion: nullableString(item.methodology_version) ?? "unavailable",
    lastUpdatedAt: canonicalUtc(item.published_at),
  };
}

/**
 * 路径①：豁免论点只公开覆盖缺口文案，绝不携带方向或置信度字段。缺口文案来自种子；若某缺口
 * 已被重命名，则回退到该论点级覆盖缺口说明，既不隐藏局限也不让整页失败。
 */
function decodeCoverageGaps(
  rowsInput: readonly Record<string, unknown>[],
): readonly PublicCoverageGapModel[] {
  const seen = new Set<string>();
  const gaps: PublicCoverageGapModel[] = [];
  for (const row of rowsInput) {
    const item = exactRecord(row, ["thesis_id", "gap_id", "title"]);
    const thesisId = nonEmptyString(item.thesis_id);
    if (seen.has(thesisId)) throw new ReadModelStorageError();
    seen.add(thesisId);
    const gapId = nonEmptyString(item.gap_id);
    const title = nonEmptyString(item.title);
    const gapDescription = coverageGapDescription(thesisId, gapId);
    if (gapDescription === null) throw new ReadModelStorageError();
    gaps.push({ thesisId, title, gapDescription });
  }
  return gaps;
}

function summarizeHealth(rowsInput: readonly Record<string, unknown>[], generatedAt: string): {
  readonly counts: OverviewPageModel["sourceHealth"];
  readonly freshness: PageFreshness;
} {
  const counts = { healthy: 0, delayed: 0, stale: 0, broken: 0 };
  const ids = new Set<string>();
  for (const row of rowsInput) {
    const item = exactRecord(row, [
      "id", "last_success_at", "late_after_minutes", "stale_after_minutes", "consecutive_failures", "last_error_code",
    ]);
    const sourceId = nonEmptyString(item.id);
    if (ids.has(sourceId)) throw new ReadModelStorageError();
    ids.add(sourceId);
    const errorCode = item.last_error_code === null
      ? null
      : enumValue(item.last_error_code, SOURCE_ERROR_CODES) as SourceErrorCode;
    const status: SourceHealthStatus = calculateSourceHealth({
      sourceId,
      checkedAt: generatedAt,
      lastSuccessAt: nullableCanonicalUtc(item.last_success_at),
      lateAfterMinutes: integer(item.late_after_minutes, 0),
      staleAfterMinutes: integer(item.stale_after_minutes, 0),
      consecutiveFailures: integer(item.consecutive_failures, 0),
      lastErrorCode: errorCode,
    }).status;
    counts[status] += 1;
  }
  return {
    counts,
    freshness: counts.stale > 0 || counts.broken > 0 ? "stale" : "current",
  };
}

function changeSummary(type: PublicChangeModel["type"]): string {
  const summaries: Record<PublicChangeModel["type"], string> = {
    observation: "新增公开观测",
    revision: "公开观测已修订",
    threshold: "已触发已审核阈值",
    thesis: "公开论点已更新",
    source_health: "来源健康状态已变化",
    manual: "研究编辑标记了重要变化",
  };
  return summaries[type];
}

function rows(result: D1Result<Record<string, unknown>> | undefined): readonly Record<string, unknown>[] {
  if (result?.success !== true || !Array.isArray(result.results)) throw new ReadModelStorageError();
  return result.results;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ReadModelStorageError();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ReadModelStorageError();
  }
  return record;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new ReadModelStorageError();
  return value as T[number];
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ReadModelStorageError();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return nonEmptyString(value);
}

function nullablePercentage(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new ReadModelStorageError();
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (typeof value !== "string") throw new ReadModelStorageError();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new ReadModelStorageError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof ReadModelStorageError) throw error;
    reportStorageFailure("read-models.stringArray", error);
    throw new ReadModelStorageError();
  }
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < minimum || value > maximum) {
    throw new ReadModelStorageError();
  }
  return value;
}

function canonicalUtc(value: unknown): string {
  if (typeof value !== "string") throw new ReadModelStorageError();
  assertCanonicalUtc(value);
  return value;
}

function nullableCanonicalUtc(value: unknown): string | null {
  return value === null ? null : canonicalUtc(value);
}

function assertCanonicalUtc(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new ReadModelStorageError();
  if (new Date(value).toISOString() !== value) throw new ReadModelStorageError();
}

function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReadModelStorageError();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) throw new ReadModelStorageError();
  return value;
}

function isPublicSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function assertChangesCursor(cursor: ChangesCursor): void {
  assertCanonicalUtc(cursor.detectedAt);
  if (cursor.id.trim().length === 0 || cursor.id.length > 256) throw new ReadModelStorageError();
}

function encodeChangesCursor(change: PublicChangeModel): string {
  return JSON.stringify({ detectedAt: change.detectedAt, id: change.id });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
