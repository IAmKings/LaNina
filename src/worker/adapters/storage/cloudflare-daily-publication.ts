import { reportStorageFailure } from "./storage-logging";
import { REQUIRED_DAILY_THESIS_IDS } from "../../../domain/daily-brief";
import {
  DailyPublicationTargetError,
  type CutoffThesisVersion,
  type DailyPublicationTargetRepository,
  type PreviousBriefFacts,
} from "../../modules/daily-publication";

/**
 * Resolves the six target versions for a manual daily-brief publication.
 *
 * Unlike the scheduled candidate lookup, this is not restricted to `system:daily-evaluation`
 * creators: an operator may publish a human-reviewed thesis version and still freeze a daily brief
 * for the same cutoff. Eligibility rules stay identical to the publication gate.
 */
export class D1DailyPublicationTargetRepository implements DailyPublicationTargetRepository {
  constructor(private readonly database: D1Database) {}

  async findCutoffVersions(cutoff: string): Promise<readonly CutoffThesisVersion[]> {
    const placeholders = REQUIRED_DAILY_THESIS_IDS.map(() => "?").join(", ");
    try {
      const result = await this.database.prepare(
        `SELECT version.thesis_id, version.id AS thesis_version_id, version.version, version.status,
                version.direction, version.stage, version.confidence, version.summary,
                (SELECT MAX(latest.version) FROM thesis_versions latest
                  WHERE latest.thesis_id = version.thesis_id) AS latest_version
           FROM thesis_versions version
          WHERE version.thesis_id IN (${placeholders})
            AND version.based_on_cutoff = ?
          ORDER BY version.thesis_id, version.version`,
      ).bind(...REQUIRED_DAILY_THESIS_IDS, cutoff).all<Record<string, unknown>>();
      if (result.success !== true || !Array.isArray(result.results)) throw databaseError();
      return result.results.map(decodeVersion);
    } catch (error) {
      if (error instanceof DailyPublicationTargetError) throw error;
      reportStorageFailure("daily-publication.findCutoffVersions", error);
      throw databaseError();
    }
  }

  async findPreviousBriefFacts(briefDate: string): Promise<PreviousBriefFacts | null> {
    try {
      // 对照基准与高风险转场审核一致：briefDate 之前最近一期 published 简报。
      // 冻结链接（daily_brief_theses）只覆盖当期真实冻结的版本；被豁免论点不在其中。
      const result = await this.database.prepare(
        `SELECT brief.headline, brief.summary, links.thesis_id,
                version.direction, version.stage, version.confidence
           FROM daily_briefs brief
           JOIN daily_brief_theses links
             ON links.brief_date = brief.brief_date
           JOIN thesis_versions version
             ON version.id = links.thesis_version_id
            AND version.thesis_id = links.thesis_id
          WHERE brief.status = 'published'
            AND brief.brief_date = (
              SELECT MAX(prior.brief_date) FROM daily_briefs prior
               WHERE prior.status = 'published' AND prior.brief_date < ?
            )
          ORDER BY links.thesis_id`,
      ).bind(briefDate).all<Record<string, unknown>>();
      if (result.success !== true || !Array.isArray(result.results)) throw databaseError();
      const rows = result.results;
      if (rows.length === 0) return null;
      const headline = rows[0]!.headline;
      const summary = rows[0]!.summary;
      if (typeof headline !== "string" || typeof summary !== "string") throw databaseError();
      const theses = rows.map((row) => {
        const thesisId = row.thesis_id;
        if (typeof thesisId !== "string") throw databaseError();
        return {
          thesisId,
          direction: nullableString(row.direction),
          stage: nullableString(row.stage),
          confidence: nullableConfidence(row.confidence),
        };
      });
      return { headline, summary, theses };
    } catch (error) {
      if (error instanceof DailyPublicationTargetError) throw error;
      reportStorageFailure("daily-publication.findPreviousBriefFacts", error);
      throw databaseError();
    }
  }
}

function decodeVersion(row: Record<string, unknown>): CutoffThesisVersion {
  const thesisId = row.thesis_id;
  const thesisVersionId = row.thesis_version_id;
  const version = row.version;
  const latest = row.latest_version;
  const status = row.status;
  if (
    typeof thesisId !== "string"
    || typeof thesisVersionId !== "string"
    || !Number.isInteger(version)
    || (version as number) < 1
    || !Number.isInteger(latest)
    || (latest as number) < 1
    || (status !== "draft" && status !== "published" && status !== "withdrawn")
  ) {
    throw databaseError();
  }
  return {
    thesisId,
    thesisVersionId,
    version: version as number,
    status,
    isLatest: version === latest,
    direction: nullableString(row.direction),
    stage: nullableString(row.stage),
    confidence: nullableConfidence(row.confidence),
    summary: nullableString(row.summary),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableConfidence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function databaseError(): DailyPublicationTargetError {
  return new DailyPublicationTargetError("DATABASE", "每日判定目标暂不可用，请稍后重试");
}
